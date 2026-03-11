import { createBluefinClient } from "../lib/client.js";
import { CONFIG } from "../lib/config.js";
import { fromE9, fmt, fmtUsd, fmtPct } from "../lib/format.js";
import { deriveProfile, type AssetProfileInput } from "../lib/asset-profile.js";

async function main() {
  const symbol = CONFIG.symbol;
  console.log(`\n=== Bluefin Check: ${symbol} ===\n`);

  const client = await createBluefinClient();

  // ── 1. Ticker ──────────────────────────────────────────────────────
  console.log("── Ticker ──");
  const tickerRes = await client.exchangeDataApi.getMarketTicker(symbol);
  const t = tickerRes.data;
  console.log(`  Mark Price:    ${fmtUsd(fromE9(t.markPriceE9))}`);
  console.log(`  Oracle Price:  ${fmtUsd(fromE9(t.oraclePriceE9))}`);
  console.log(`  Market Price:  ${fmtUsd(fromE9(t.marketPriceE9))}`);
  console.log(`  Last Price:    ${fmtUsd(fromE9(t.lastPriceE9))}`);
  console.log(`  Best Bid:      ${fmtUsd(fromE9(t.bestBidPriceE9))}`);
  console.log(`  Best Ask:      ${fmtUsd(fromE9(t.bestAskPriceE9))}`);
  console.log(`  24h Volume:    ${fmtUsd(fromE9(t.quoteVolume24hrE9))}`);
  console.log(`  Open Interest: ${fmtUsd(fromE9(t.openInterestE9))}`);
  console.log(`  Funding Rate:  ${fmtPct(fromE9(t.lastFundingRateE9))}`);
  console.log(`  Avg FR (8h):   ${fmtPct(fromE9(t.avgFundingRate8hrE9))}`);
  console.log();

  // ── 2. Funding Rate History (last 24 entries) ─────────────────────
  console.log("── Funding Rate History (last 24) ──");
  const frRes = await client.exchangeDataApi.getFundingRateHistory(symbol, 24);
  const frEntries = frRes.data;
  for (const entry of frEntries) {
    const ts = new Date(entry.fundingTimeAtMillis).toISOString();
    const rate = fromE9(entry.fundingRateE9);
    console.log(`  ${ts}  ${fmtPct(rate, 6)}`);
  }
  console.log();

  // ── 3. Order Book (top 5 bids/asks) ───────────────────────────────
  console.log("── Order Book (top 5) ──");
  const bookRes = await client.exchangeDataApi.getOrderbookDepth(symbol, 5);
  const book = bookRes.data;

  console.log("  Asks:");
  const asks = book.asksE9.slice(0, 5).reverse();
  for (const [priceE9, qtyE9] of asks) {
    console.log(`    ${fmtUsd(fromE9(priceE9)).padStart(12)}  ${fmt(fromE9(qtyE9), 4)}`);
  }
  console.log("  ──────────────────────");
  const bids = book.bidsE9.slice(0, 5);
  console.log("  Bids:");
  for (const [priceE9, qtyE9] of bids) {
    console.log(`    ${fmtUsd(fromE9(priceE9)).padStart(12)}  ${fmt(fromE9(qtyE9), 4)}`);
  }
  console.log();

  // ── 4. Account State ──────────────────────────────────────────────
  console.log("── Account State ──");
  const acctRes = await client.accountDataApi.getAccountDetails();
  const acct = acctRes.data;
  console.log(`  Address:         ${acct.accountAddress}`);
  console.log(`  Account Value:   ${fmtUsd(fromE9(acct.totalAccountValueE9))}`);
  console.log(`  Cross Balance:   ${fmtUsd(fromE9(acct.crossEffectiveBalanceE9))}`);
  console.log(`  Margin Avail:    ${fmtUsd(fromE9(acct.marginAvailableE9))}`);
  console.log(`  Unrealized PnL:  ${fmtUsd(fromE9(acct.totalUnrealizedPnlE9))}`);
  console.log(`  Maker Fee:       ${fmtPct(fromE9(acct.tradingFees.makerFeeE9))}`);
  console.log(`  Taker Fee:       ${fmtPct(fromE9(acct.tradingFees.takerFeeE9))}`);

  if (acct.assets.length > 0) {
    console.log("  Assets:");
    for (const a of acct.assets) {
      console.log(`    ${a.symbol}: ${fmtUsd(fromE9(a.quantityE9))}`);
    }
  }

  if (acct.positions.length > 0) {
    console.log("  Positions:");
    for (const p of acct.positions) {
      console.log(`    ${p.symbol} ${p.side} size=${fmt(fromE9(p.sizeE9))} entry=${fmtUsd(fromE9(p.avgEntryPriceE9))} uPnL=${fmtUsd(fromE9(p.unrealizedPnlE9))} liq=${fmtUsd(fromE9(p.liquidationPriceE9))}`);
    }
  } else {
    console.log("  Positions: (none)");
  }
  console.log();

  // ── 5. Exchange Info + Recommended AssetProfile ───────────────────
  console.log("── Recommended AssetProfile Parameters ──");
  const infoRes = await client.exchangeDataApi.getExchangeInfo();
  const market = infoRes.data.markets.find((m) => m.symbol === symbol);
  if (!market) {
    console.log(`  Market ${symbol} not found in exchange info.`);
  } else {
    const mmr = fromE9(market.maintenanceMarginRatioE9);
    const imr = fromE9(market.initialMarginRatioE9);
    const maxLeverage = Math.floor(1 / imr);
    const makerFee = fromE9(acct.tradingFees.makerFeeE9);
    const takerFee = fromE9(acct.tradingFees.takerFeeE9);

    const input: AssetProfileInput = {
      symbol,
      mmr,
      maxLeverage,
      makerFee,
      takerFee,
      hourlyVolatility: 0.007, // default SUI sigma_h
    };

    const profile = deriveProfile(input);

    console.log(`  MMR:              ${fmtPct(mmr)}`);
    console.log(`  IMR:              ${fmtPct(imr)}`);
    console.log(`  Max Leverage:     ${maxLeverage}x`);
    console.log(`  Maker Fee:        ${fmtPct(makerFee)}`);
    console.log(`  Taker Fee:        ${fmtPct(takerFee)}`);
    console.log(`  ---`);
    console.log(`  Derived leverage:          ${profile.leverage}x`);
    console.log(`  Margin buffer:             ${fmtPct(profile.marginBufferPct)}`);
    console.log(`  Neg FR hours exit:         ${profile.negFrHoursExit}h`);
    console.log(`  Cumulative FR floor (7d):  ${fmtPct(profile.cumulativeFrFloor7d)}`);
    console.log(`  Re-entry positive hours:   ${profile.reentryPositiveHours}h`);
    console.log(`  Re-entry wait hours:       ${profile.reentryWaitHours}h`);
    console.log(`  OI floor:                  ${fmtUsd(profile.oiFloor)}`);
    console.log(`  Delta tolerance:           ${fmtPct(profile.deltaTolerancePct)}`);
    console.log(`  Margin stop:               ${fmtPct(profile.marginStopPct)}`);
    console.log(`  Circuit breaker:           ${fmtPct(profile.circuitBreakerPct)}`);
  }

  console.log("\n=== Done ===\n");
  await client.dispose();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
