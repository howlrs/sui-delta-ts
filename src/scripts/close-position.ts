import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  OrderSide,
  OrderType,
  OrderTimeInForce,
  PositionSide,
} from "@bluefin-exchange/pro-sdk";
import type { OrderParams, Account, Position } from "@bluefin-exchange/pro-sdk";
import { createBluefinClient } from "../lib/client.js";
import { CONFIG } from "../lib/config.js";
import { fromE9, toE9, fmt, fmtUsd } from "../lib/format.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  options: {
    symbol: { type: "string", default: CONFIG.symbol },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
});

const symbol = args.symbol ?? CONFIG.symbol;
const dryRun = args["dry-run"] ?? false;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`\n--- close-position | ${symbol} | ${dryRun ? "DRY RUN" : "LIVE"} ---\n`);

  const client = await createBluefinClient();

  // 1. Fetch account and find position
  const { data: account }: { data: Account } =
    await client.accountDataApi.getAccountDetails();

  const position: Position | undefined = account.positions.find(
    (p) => p.symbol === symbol && p.side !== PositionSide.Unspecified,
  );

  if (!position) {
    console.log(`No open position found for ${symbol}. Nothing to do.`);
    return;
  }

  const posSize = fromE9(position.sizeE9);
  const entryPrice = fromE9(position.avgEntryPriceE9);
  const markPrice = fromE9(position.markPriceE9);
  const upnl = fromE9(position.unrealizedPnlE9);
  const closeSide =
    position.side === PositionSide.Long ? OrderSide.Short : OrderSide.Long;

  console.log(`Position  : ${position.side} ${fmt(posSize)} @ ${fmtUsd(entryPrice)}`);
  console.log(`Mark      : ${fmtUsd(markPrice)}`);
  console.log(`uPnL      : ${fmtUsd(upnl)}`);
  console.log(`Close side: ${closeSide}\n`);

  // 2. Dry-run check
  if (dryRun) {
    console.log("[DRY RUN] Would place reduce-only MARKET order:");
    console.log(`  side     = ${closeSide}`);
    console.log(`  quantity = ${fmt(posSize)}`);
    console.log(`  symbol   = ${symbol}`);
    console.log("[DRY RUN] Would then withdraw all USDC.\n");
    return;
  }

  // 3. Place reduce-only market close order
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

  console.log("Placing reduce-only market close order...");
  const orderResult = await client.createOrder(orderParams);
  console.log("Order placed:", JSON.stringify(orderResult?.data ?? orderResult, null, 2));

  // 4. Withdraw all USDC
  // Re-fetch account to get updated balances after close
  const { data: updatedAccount }: { data: Account } =
    await client.accountDataApi.getAccountDetails();

  const usdcAsset = updatedAccount.assets.find((a) => a.symbol === "USDC");
  const withdrawable = usdcAsset?.maxWithdrawQuantityE9 ?? "0";
  const withdrawableNum = fromE9(withdrawable);

  if (withdrawableNum > 0) {
    console.log(`\nWithdrawing ${fmtUsd(withdrawableNum)} USDC...`);
    await client.withdraw("USDC", withdrawable);
    console.log("Withdraw complete.");
  } else {
    console.log("\nNo withdrawable USDC balance.");
  }

  // 5. Final summary
  console.log("\n--- Summary ---");
  console.log(`Closed    : ${position.side} ${fmt(posSize)} ${symbol}`);
  console.log(`Entry     : ${fmtUsd(entryPrice)}`);
  console.log(`Mark      : ${fmtUsd(markPrice)}`);
  console.log(`uPnL      : ${fmtUsd(upnl)}`);
  console.log(`Withdrawn : ${fmtUsd(withdrawableNum)} USDC`);
  console.log("Done.\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
