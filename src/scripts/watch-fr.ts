import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  OrderSide,
  OrderType,
  OrderTimeInForce,
  PositionSide,
} from "@bluefin-exchange/pro-sdk";
import type {
  OrderParams,
  Account,
  Position,
  TickerResponse,
  BluefinProSdk,
} from "@bluefin-exchange/pro-sdk";
import { createBluefinClient } from "../lib/client.js";
import { CONFIG } from "../lib/config.js";
import { fromE9, toE9, fmt, fmtUsd, fmtPct } from "../lib/format.js";
import { deriveProfile } from "../lib/asset-profile.js";
import type { AssetProfile, AssetProfileInput } from "../lib/asset-profile.js";
import { loadState, saveState } from "../lib/state.js";
import type { WatchState } from "../lib/state.js";
import { notify } from "../lib/notify.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const { values: cliArgs } = parseArgs({
  options: {
    interval: { type: "string", default: "3600" },
  },
  strict: true,
});

const intervalMs = (Number(cliArgs.interval) || 3600) * 1000;

// ---------------------------------------------------------------------------
// Default asset profile (SUI-PERP)
// ---------------------------------------------------------------------------
const DEFAULT_PROFILE_INPUT: AssetProfileInput = {
  symbol: CONFIG.symbol,
  mmr: 0.03,
  maxLeverage: 20,
  makerFee: 0.0002,
  takerFee: 0.0005,
  hourlyVolatility: 0.007,
};

const profile: AssetProfile = deriveProfile(DEFAULT_PROFILE_INPUT);

// ---------------------------------------------------------------------------
// State (persisted to disk)
// ---------------------------------------------------------------------------
const state: WatchState = loadState();

// ---------------------------------------------------------------------------
// Tick guard — prevent overlapping ticks
// ---------------------------------------------------------------------------
let tickRunning = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Close the current position using reduce-only IOC market order.
 * Does NOT withdraw — funds stay on Bluefin for potential re-entry.
 */
async function closePosition(
  client: BluefinProSdk,
  symbol: string,
  position: Position,
  reason: string,
): Promise<void> {
  const posSize = fromE9(position.sizeE9);
  const closeSide =
    position.side === PositionSide.Long ? OrderSide.Short : OrderSide.Long;

  await notify("critical", `CLOSING ${position.side} ${fmt(posSize)} ${symbol}: ${reason}`);

  const orderParams: OrderParams = {
    clientOrderId: randomUUID(),
    type: OrderType.Market,
    symbol,
    priceE9: "0",
    quantityE9: toE9(posSize),
    side: closeSide,
    leverageE9: position.clientSetLeverageE9,
    isIsolated: position.isIsolated,
    expiresAtMillis: Date.now() + 60_000,
    reduceOnly: true,
    timeInForce: OrderTimeInForce.Ioc,
  };

  const orderResult = await client.createOrder(orderParams);
  console.log(
    `[${ts()}] Close order result:`,
    JSON.stringify(orderResult?.data ?? orderResult, null, 2),
  );

  state.positionOpen = false;
  state.lastCloseTime = Date.now();
  saveState(state);
}

/**
 * Re-enter a short position. Uses taker market order, same logic as open-short.
 * Estimates notional from account balance, deposits if needed.
 */
async function reenterShort(
  client: BluefinProSdk,
  symbol: string,
  price: number,
): Promise<void> {
  await notify("warn", `RE-ENTERING short on ${symbol} @ ~${fmtUsd(price)}`);

  // Get account state to determine available balance
  const { data: account }: { data: Account } =
    await client.accountDataApi.getAccountDetails();

  // Use cross effective balance as notional basis (leveraged)
  const balance = fromE9(account.crossEffectiveBalanceE9);
  const leverage = profile.leverage;
  const notional = balance * leverage;
  const quantity = notional / price;

  if (quantity <= 0 || notional < 10) {
    await notify("critical", `Insufficient balance for re-entry: ${fmtUsd(balance)}`);
    return;
  }

  console.log(
    `[${ts()}]   Balance: ${fmtUsd(balance)}, Notional: ${fmtUsd(notional)}, Qty: ${fmt(quantity, 6)}`,
  );

  // Set leverage
  await client.updateLeverage(symbol, toE9(leverage));

  // Place market short
  const orderParams: OrderParams = {
    clientOrderId: randomUUID(),
    type: OrderType.Market,
    symbol,
    priceE9: "0",
    quantityE9: toE9(quantity),
    side: OrderSide.Short,
    leverageE9: toE9(leverage),
    isIsolated: false,
    expiresAtMillis: Date.now() + 60_000,
    timeInForce: OrderTimeInForce.Ioc,
  };

  const orderResult = await client.createOrder(orderParams);
  console.log(
    `[${ts()}] Re-entry order result:`,
    JSON.stringify(orderResult?.data ?? orderResult, null, 2),
  );

  state.positionOpen = true;
  saveState(state);
}

// ---------------------------------------------------------------------------
// Main loop tick
// ---------------------------------------------------------------------------
async function tick(client: BluefinProSdk): Promise<void> {
  const symbol = CONFIG.symbol;

  // 1. Account + position health check
  const { data: account }: { data: Account } =
    await client.accountDataApi.getAccountDetails();
  const position: Position | undefined = account.positions.find(
    (p) => p.symbol === symbol && p.side !== PositionSide.Unspecified,
  );
  state.positionOpen = !!position;

  // 2. Ticker data — price, OI
  const tickerRes = await client.exchangeDataApi.getMarketTicker(symbol);
  const ticker: TickerResponse = tickerRes.data;
  const price = fromE9(ticker.lastPriceE9);
  const oi = fromE9(ticker.openInterestE9);

  // 3. Funding rate — latest value
  const fr = fromE9(ticker.lastFundingRateE9);

  // Update FR history (cap at 168 = 7 days of hourly)
  state.frHistory7d.push(fr);
  if (state.frHistory7d.length > 168) {
    state.frHistory7d = state.frHistory7d.slice(-168);
  }

  // Update negative streak
  if (fr < 0) {
    state.negativeStreakHours++;
  } else {
    state.negativeStreakHours = 0;
  }

  // Update total earned (positive FR = earning for short)
  state.totalFrEarned += fr;

  // Compute rolling stats
  const cumFr7d = state.frHistory7d.reduce((s, v) => s + v, 0);
  const avg168h =
    state.frHistory7d.length > 0
      ? cumFr7d / state.frHistory7d.length
      : 0;
  const avg24h = (() => {
    const last24 = state.frHistory7d.slice(-24);
    return last24.length > 0
      ? last24.reduce((s, v) => s + v, 0) / last24.length
      : 0;
  })();

  // 4. Compact log line
  const posStatus = state.positionOpen
    ? `OPEN ${position!.side} ${fmt(fromE9(position!.sizeE9))}`
    : "CLOSED";
  console.log(
    `[${ts()}] FR=${fmtPct(fr, 6)} streak=${state.negativeStreakHours}h cum7d=${fmtPct(cumFr7d, 4)} avg168h=${fmtPct(avg168h, 6)} avg24h=${fmtPct(avg24h, 6)} OI=${fmtUsd(oi)} price=${fmtUsd(price)} pos=${posStatus}`,
  );

  // 5. If position open — auto-close checks
  if (state.positionOpen && position) {
    let closeReason: string | null = null;

    // A. Negative consecutive hours >= negFrHoursExit
    if (state.negativeStreakHours >= profile.negFrHoursExit) {
      closeReason = `neg FR streak ${state.negativeStreakHours}h >= ${profile.negFrHoursExit}h`;
    }

    // B. Cumulative FR loss 7d >= cumulativeFrFloor7d (floor is negative)
    if (!closeReason && cumFr7d <= profile.cumulativeFrFloor7d) {
      closeReason = `cum FR 7d ${fmtPct(cumFr7d)} <= floor ${fmtPct(profile.cumulativeFrFloor7d)}`;
    }

    // C. 168h rolling avg FR <= 0 (need >= 168 samples)
    if (!closeReason && state.frHistory7d.length >= 168 && avg168h <= profile.rollingAvgFrClose) {
      closeReason = `168h avg FR ${fmtPct(avg168h, 6)} <= 0`;
    }

    // D. OI < oiFloor
    if (!closeReason && oi < profile.oiFloor) {
      closeReason = `OI ${fmtUsd(oi)} < floor ${fmtUsd(profile.oiFloor)}`;
    }

    // E. Price circuit breaker: |price change since last hour| > circuitBreakerPct
    if (!closeReason && state.lastPrice !== null) {
      const pctChange = Math.abs(price - state.lastPrice) / state.lastPrice;
      if (pctChange > profile.circuitBreakerPct) {
        closeReason = `circuit breaker: price change ${fmtPct(pctChange)} > ${fmtPct(profile.circuitBreakerPct)}`;
      }
    }

    // F. Margin stop: unrealized PnL / margin <= marginStopPct
    if (!closeReason) {
      const unrealizedPnl = fromE9(position.unrealizedPnlE9);
      const marginRequired = fromE9(position.marginRequiredE9);
      if (marginRequired > 0) {
        const pnlRatio = unrealizedPnl / marginRequired;
        if (pnlRatio <= profile.marginStopPct) {
          closeReason = `margin stop: uPnL/margin ${fmtPct(pnlRatio)} <= ${fmtPct(profile.marginStopPct)}`;
        }
      }
    }

    // G. Margin health warning: margin ratio < 12%
    const accountValue = fromE9(account.totalAccountValueE9);
    const marginAvailable = fromE9(account.marginAvailableE9);
    if (accountValue > 0) {
      const marginRatio = marginAvailable / accountValue;
      if (marginRatio < 0.12) {
        await notify("warn", `Margin ratio ${fmtPct(marginRatio)} < 12%`);
      }
    }

    if (closeReason) {
      await closePosition(client, symbol, position, closeReason);
    }
  }

  // 6. If position closed — re-entry checks
  if (!state.positionOpen) {
    const canReenter = (() => {
      // Wait at least reentryWaitHours since lastCloseTime
      if (state.lastCloseTime !== null) {
        const hoursSinceClose =
          (Date.now() - state.lastCloseTime) / (3600 * 1000);
        if (hoursSinceClose < profile.reentryWaitHours) {
          return false;
        }
      }

      // Last reentryPositiveHours FR values all positive
      const recentFr = state.frHistory7d.slice(
        -profile.reentryPositiveHours,
      );
      if (
        recentFr.length < profile.reentryPositiveHours ||
        recentFr.some((v) => v <= 0)
      ) {
        return false;
      }

      // 24h avg FR > 0.000005 (0.0005%)
      if (avg24h <= 0.000005) {
        return false;
      }

      return true;
    })();

    if (canReenter) {
      await reenterShort(client, symbol, price);
    }
  }

  // Update lastPrice for next iteration's circuit breaker
  state.lastPrice = price;

  // Persist state after every tick
  saveState(state);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const symbol = CONFIG.symbol;
  console.log(`\n=== watch-fr daemon | ${symbol} | interval=${intervalMs / 1000}s ===`);
  console.log(`Profile: leverage=${profile.leverage}x negFrExit=${profile.negFrHoursExit}h cumFloor7d=${fmtPct(profile.cumulativeFrFloor7d)} marginStop=${fmtPct(profile.marginStopPct)} reentryWait=${profile.reentryWaitHours}h reentryPos=${profile.reentryPositiveHours}h oiFloor=${fmtUsd(profile.oiFloor)} circuitBreaker=${fmtPct(profile.circuitBreakerPct)}\n`);

  // Log restored state
  if (state.lastCloseTime !== null) {
    const ago = ((Date.now() - state.lastCloseTime) / 3_600_000).toFixed(1);
    console.log(`[${ts()}] Restored state: lastClose=${ago}h ago, streak=${state.negativeStreakHours}h, frHistory=${state.frHistory7d.length} entries, totalFR=${fmtPct(state.totalFrEarned)}`);
  }

  const client = await createBluefinClient();

  // Seed FR history only if state was empty (fresh start)
  if (state.frHistory7d.length === 0) {
    try {
      const frRes = await client.exchangeDataApi.getFundingRateHistory(symbol, 168);
      const frEntries = frRes.data;
      for (const entry of frEntries) {
        state.frHistory7d.push(fromE9(entry.fundingRateE9));
      }
      console.log(`[${ts()}] Seeded ${state.frHistory7d.length} historical FR values`);
      saveState(state);
    } catch (err) {
      console.log(`[${ts()}] Could not seed FR history: ${err}`);
    }
  } else {
    console.log(`[${ts()}] Using ${state.frHistory7d.length} FR values from persisted state`);
  }

  // Check initial position state
  try {
    const { data: account }: { data: Account } =
      await client.accountDataApi.getAccountDetails();
    const position = account.positions.find(
      (p) => p.symbol === symbol && p.side !== PositionSide.Unspecified,
    );
    state.positionOpen = !!position;
    console.log(
      `[${ts()}] Initial position state: ${state.positionOpen ? "OPEN" : "CLOSED"}`,
    );
  } catch (err) {
    console.log(`[${ts()}] Could not check initial position: ${err}`);
  }

  await notify("info", `watch-fr started: ${symbol}, interval=${intervalMs / 1000}s`);

  // Run first tick immediately, then on interval with overlap guard
  await tick(client);

  setInterval(async () => {
    if (tickRunning) {
      console.log(`[${ts()}] Tick skipped (previous still running)`);
      return;
    }
    tickRunning = true;
    try {
      await tick(client);
    } catch (err) {
      console.error(`[${ts()}] Tick error:`, err);
      await notify("critical", `Tick error: ${err}`);
    } finally {
      tickRunning = false;
    }
  }, intervalMs);
}

main().catch(async (err) => {
  console.error("Fatal:", err);
  await notify("critical", `watch-fr FATAL: ${err}`);
  process.exit(1);
});
