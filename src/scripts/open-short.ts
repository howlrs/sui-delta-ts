import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../lib/config.js";
import { createBluefinClient } from "../lib/client.js";
import { toE9, fromE9, fmt, fmtUsd } from "../lib/format.js";
import { deriveProfile } from "../lib/asset-profile.js";
import type { AssetProfileInput } from "../lib/asset-profile.js";
import {
  OrderSide,
  OrderType,
  OrderTimeInForce,
  type OrderParams,
  type TickerResponse,
} from "@bluefin-exchange/pro-sdk";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    usd: { type: "string" },
    leverage: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});

const usd = Number(args.usd);
if (!args.usd || Number.isNaN(usd) || usd <= 0) {
  console.error("Usage: open-short --usd <amount> [--leverage <N>] [--dry-run]");
  process.exit(1);
}

const dryRun = args["dry-run"] ?? false;

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

const profile = deriveProfile(DEFAULT_PROFILE_INPUT);
const leverage = args.leverage ? Number(args.leverage) : profile.leverage;

if (Number.isNaN(leverage) || leverage < 1) {
  console.error("Invalid --leverage value");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const symbol = CONFIG.symbol;

  console.log(`\n--- open-short ${symbol} ---`);
  console.log(`  Notional:  ${fmtUsd(usd)}`);
  console.log(`  Leverage:  ${leverage}x`);
  console.log(`  Dry-run:   ${dryRun}\n`);

  const client = await createBluefinClient();

  // 1. Get current price from ticker
  const tickerRes = await client.exchangeDataApi.getMarketTicker(symbol);
  const ticker: TickerResponse = tickerRes.data;
  const price = fromE9(ticker.lastPriceE9);
  console.log(`  Price:     ${fmtUsd(price)}`);

  // 2. Calculate quantity = notional / price
  const quantity = usd / price;
  console.log(`  Quantity:  ${fmt(quantity, 6)}`);

  // 3. Calculate margin needed = notional / leverage + buffer
  const margin = usd / leverage;
  const buffer = margin * profile.marginBufferPct;
  const depositAmount = margin + buffer;
  console.log(`  Margin:    ${fmtUsd(margin)}`);
  console.log(`  Buffer:    ${fmtUsd(buffer)} (${(profile.marginBufferPct * 100).toFixed(1)}%)`);
  console.log(`  Deposit:   ${fmtUsd(depositAmount)}\n`);

  if (dryRun) {
    console.log("[DRY-RUN] Would execute:");
    console.log(`  1. Deposit ${fmtUsd(depositAmount)} USDC`);
    console.log(`  2. Set leverage to ${leverage}x`);
    console.log(`  3. Market SHORT ${fmt(quantity, 6)} ${symbol} @ ~${fmtUsd(price)}`);
    console.log("\nNo actions taken.");
    return;
  }

  // 4. Deposit USDC
  console.log(`Depositing ${fmtUsd(depositAmount)} USDC...`);
  await client.deposit(toE9(depositAmount));
  console.log("  Deposit confirmed.\n");

  // 5. Set leverage
  console.log(`Setting leverage to ${leverage}x...`);
  await client.updateLeverage(symbol, toE9(leverage));
  console.log("  Leverage set.\n");

  // 6. Place market short order
  const orderParams: OrderParams = {
    clientOrderId: randomUUID(),
    type: OrderType.Market,
    symbol,
    priceE9: "0",
    quantityE9: toE9(quantity),
    side: OrderSide.Short,
    leverageE9: toE9(leverage),
    isIsolated: false,
    expiresAtMillis: Date.now() + 60_000, // 1 minute
    timeInForce: OrderTimeInForce.Ioc,
  };

  console.log("Placing market SHORT order...");
  const orderResult = await client.createOrder(orderParams);
  console.log("  Order placed:", JSON.stringify(orderResult?.data ?? orderResult, null, 2));

  // 7. Display post-trade position summary
  console.log("\n--- Post-trade summary ---");
  const accountRes = await client.accountDataApi.getAccountDetails();
  const account = accountRes.data;
  const position = account.positions.find(
    (p) => p.symbol === symbol && p.sizeE9 !== "0",
  );

  if (position) {
    console.log(`  Symbol:      ${position.symbol}`);
    console.log(`  Side:        ${position.side}`);
    console.log(`  Size:        ${fmt(fromE9(position.sizeE9), 6)}`);
    console.log(`  Entry:       ${fmtUsd(fromE9(position.avgEntryPriceE9))}`);
    console.log(`  Notional:    ${fmtUsd(fromE9(position.notionalValueE9))}`);
    console.log(`  Leverage:    ${fmt(fromE9(position.clientSetLeverageE9), 1)}x`);
    console.log(`  Liq. price:  ${fmtUsd(fromE9(position.liquidationPriceE9))}`);
    console.log(`  uPnL:        ${fmtUsd(fromE9(position.unrealizedPnlE9))}`);
  } else {
    console.log("  No open position found for", symbol);
  }

  console.log(`\n  Account value: ${fmtUsd(fromE9(account.totalAccountValueE9))}`);
  console.log("---\n");
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
