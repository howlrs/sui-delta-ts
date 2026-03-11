# Delta-Neutral FR Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bluefin SUI-PERP FR capture + Spot SUI LST のデルタニュートラル戦略を $3K で運用する TypeScript ツール群を構築する。

**Architecture:** 共通 lib 層 (SDK初期化, E9変換, AssetProfile) + 4つの独立スクリプト (check, open, close, watch)。watch-fr.ts は Docker 常駐サービスとして GCE にデプロイ。

**Tech Stack:** TypeScript, tsx, @bluefin-exchange/pro-sdk v1.13.0, @mysten/sui v1.x, Docker, docker-compose

---

## Task 1: Project Initialization

**Issue:** #7 (Bluefin Pro SDK integration)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

**Step 1: Initialize package.json**

```bash
cd /home/o9oem/projects/mine/sui-delta-ts
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install @bluefin-exchange/pro-sdk @mysten/sui dotenv
npm install -D typescript @types/node tsx
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Add npm scripts to package.json**

```json
{
  "scripts": {
    "check": "tsx src/scripts/check-bluefin.ts",
    "open-short": "tsx src/scripts/open-short.ts",
    "close": "tsx src/scripts/close-position.ts",
    "watch": "tsx src/scripts/watch-fr.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 5: Create directory structure**

```bash
mkdir -p src/lib src/scripts
```

**Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors (no source files yet, clean pass).

**Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example
git commit -m "chore: project init with bluefin-pro-sdk and typescript"
```

---

## Task 2: Shared Library — config.ts, format.ts, client.ts

**Issue:** #7

**Files:**
- Create: `src/lib/config.ts`
- Create: `src/lib/format.ts`
- Create: `src/lib/client.ts`

**Step 1: Create config.ts**

環境変数の読み込みと定数定義。

```typescript
// src/lib/config.ts
import "dotenv/config";

export const CONFIG = {
  suiPrivateKey: process.env.SUI_PRIVATE_KEY ?? "",
  suiRpcUrl:
    process.env.SUI_RPC_URL ?? "https://fullnode.mainnet.sui.io:443",
  bluefinNetwork: (process.env.BLUEFIN_NETWORK ?? "mainnet") as
    | "mainnet"
    | "testnet",
  symbol: process.env.SYMBOL ?? "SUI-PERP",
} as const;

export function validateConfig(): void {
  if (!CONFIG.suiPrivateKey) {
    throw new Error("SUI_PRIVATE_KEY is required in .env");
  }
}
```

**Step 2: Create format.ts**

E9 format 変換ヘルパー。Bluefin SDK は全数値を string × 1e9 で扱う。

```typescript
// src/lib/format.ts
const E9 = 1_000_000_000;

/** number → E9 string (Bluefin SDK format) */
export function toE9(value: number): string {
  return String(Math.floor(value * E9));
}

/** E9 string → number */
export function fromE9(e9: string): number {
  return Number(e9) / E9;
}

/** Format number for display with fixed decimals */
export function fmt(value: number, decimals = 4): string {
  return value.toFixed(decimals);
}

/** Format USD amount */
export function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Format percentage */
export function fmtPct(value: number, decimals = 4): string {
  return `${(value * 100).toFixed(decimals)}%`;
}
```

**Step 3: Create client.ts**

Bluefin SDK 初期化の共通モジュール。

```typescript
// src/lib/client.ts
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  BluefinProSdk,
  BluefinRequestSigner,
  makeSigner,
} from "@bluefin-exchange/pro-sdk";
import { CONFIG, validateConfig } from "./config.js";

export async function createBluefinClient(): Promise<BluefinProSdk> {
  validateConfig();

  const suiClient = new SuiClient({ url: CONFIG.suiRpcUrl });
  const keypair = Ed25519Keypair.fromSecretKey(
    Buffer.from(CONFIG.suiPrivateKey, "hex"),
  );
  const signer = new BluefinRequestSigner(makeSigner(keypair, false));
  const client = new BluefinProSdk(signer, CONFIG.bluefinNetwork, suiClient);
  await client.initialize();

  return client;
}
```

> Note: SDK の実際の初期化 API は `npm install` 後に型定義を確認して調整すること。
> `BluefinProSdk`, `BluefinRequestSigner`, `makeSigner` の import パスや引数は
> `node_modules/@bluefin-exchange/pro-sdk` の型定義が正とする。

**Step 4: Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: パス (SDK の型に合わせて調整が必要な場合はここで修正)

**Step 5: Commit**

```bash
git add src/lib/
git commit -m "feat: add shared lib (config, format, client)"
```

---

## Task 3: AssetProfile — σ_h Based Parameter Derivation

**Issue:** #7

**Files:**
- Create: `src/lib/asset-profile.ts`
- Create: `src/lib/__tests__/asset-profile.test.ts`

**Step 1: Write tests for derivation formulas**

```typescript
// src/lib/__tests__/asset-profile.test.ts
import { describe, it, expect } from "vitest";
import { deriveProfile } from "../asset-profile.js";

describe("deriveProfile", () => {
  const SUI_PARAMS = {
    symbol: "SUI-PERP",
    mmr: 0.025,
    maxLeverage: 20,
    makerFee: 0.0001,
    takerFee: 0.00035,
    hourlyVolatility: 0.007, // σ_h = 0.70%
  };

  it("derives SUI leverage = 7x", () => {
    const p = deriveProfile(SUI_PARAMS);
    expect(p.leverage).toBe(7);
  });

  it("derives SUI negFrHoursExit = 18", () => {
    const p = deriveProfile(SUI_PARAMS);
    expect(p.negFrHoursExit).toBe(18);
  });

  it("derives SUI marginStopPct = -0.15", () => {
    const p = deriveProfile(SUI_PARAMS);
    expect(p.marginStopPct).toBeCloseTo(-0.15, 2);
  });

  it("derives SUI circuitBreakerPct ≈ 0.021", () => {
    const p = deriveProfile(SUI_PARAMS);
    expect(p.circuitBreakerPct).toBeCloseTo(0.021, 3);
  });

  it("derives BTC with lower vol → higher leverage", () => {
    const p = deriveProfile({ ...SUI_PARAMS, symbol: "BTC-PERP", mmr: 0.0175, hourlyVolatility: 0.0035 });
    expect(p.leverage).toBe(14);
    expect(p.negFrHoursExit).toBe(36);
  });

  it("derives high-vol token → lower leverage, tighter exits", () => {
    const p = deriveProfile({ ...SUI_PARAMS, symbol: "ALT-PERP", hourlyVolatility: 0.012 });
    expect(p.leverage).toBe(4);
    expect(p.negFrHoursExit).toBe(10);
  });

  it("clamps leverage to maxLeverage", () => {
    const p = deriveProfile({ ...SUI_PARAMS, hourlyVolatility: 0.001, maxLeverage: 10 });
    expect(p.leverage).toBeLessThanOrEqual(10);
  });
});
```

**Step 2: Install vitest**

```bash
npm install -D vitest
```

Add to package.json scripts: `"test": "vitest run", "test:watch": "vitest"`

**Step 3: Run tests to verify they fail**

```bash
npx vitest run
```

Expected: FAIL — `deriveProfile` not found.

**Step 4: Implement asset-profile.ts**

```typescript
// src/lib/asset-profile.ts
const SIGMA_H_SUI = 0.007; // Reference: SUI hourly vol

export interface AssetProfileInput {
  symbol: string;
  mmr: number;
  maxLeverage: number;
  makerFee: number;
  takerFee: number;
  hourlyVolatility: number; // σ_h
}

export interface AssetProfile extends AssetProfileInput {
  leverage: number;
  marginBufferPct: number;
  negFrHoursExit: number;
  cumulativeFrFloor7d: number;
  reentryPositiveHours: number;
  reentryWaitHours: number;
  oiFloor: number;
  deltaTolerancePct: number;
  marginStopPct: number;
  circuitBreakerPct: number;
  rollingAvgFrClose: number;
}

export function deriveProfile(input: AssetProfileInput): AssetProfile {
  const sigmaH = input.hourlyVolatility;
  const sigmaD = sigmaH * Math.sqrt(24);
  const sigmaR = sigmaH / SIGMA_H_SUI;

  const leverage = Math.min(
    input.maxLeverage,
    Math.max(2, Math.floor(1 / (3 * sigmaD + input.mmr + 0.02))),
  );

  const marginBufferPct = Math.min(
    0.4,
    Math.max(0.15, 3 * sigmaH * leverage),
  );

  const negFrHoursExit = Math.min(36, Math.max(6, Math.floor(18 / sigmaR)));

  const cumulativeFrFloor7d = Math.max(
    -0.02,
    Math.min(-0.002, -0.005 * sigmaR),
  );

  const reentryPositiveHours = Math.min(
    12,
    Math.max(4, Math.floor(6 * sigmaR)),
  );

  const reentryWaitHours = Math.min(
    24,
    Math.max(6, Math.floor(12 / sigmaR)),
  );

  const oiFloor = 200_000;

  const deltaTolerancePct = Math.min(
    0.05,
    Math.max(0.02, 0.03 / sigmaR),
  );

  const marginStopPct = -Math.min(
    0.25,
    Math.max(0.10, 0.15 * sigmaR),
  );

  const circuitBreakerPct = 3 * sigmaH;

  return {
    ...input,
    leverage,
    marginBufferPct,
    negFrHoursExit,
    cumulativeFrFloor7d,
    reentryPositiveHours,
    reentryWaitHours,
    oiFloor,
    deltaTolerancePct,
    marginStopPct,
    circuitBreakerPct,
    rollingAvgFrClose: 0,
  };
}
```

**Step 5: Run tests**

```bash
npx vitest run
```

Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/lib/asset-profile.ts src/lib/__tests__/ package.json
git commit -m "feat: add AssetProfile with σ_h-based parameter derivation"
```

---

## Task 4: check-bluefin.ts

**Issue:** #7

**Files:**
- Create: `src/scripts/check-bluefin.ts`

**Step 1: Implement check-bluefin.ts**

SDK 接続確認、SUI-PERP ticker、FR history、order book、アカウント状態を表示。
AssetProfile の推奨パラメータも出力。

```typescript
// src/scripts/check-bluefin.ts
import { createBluefinClient } from "../lib/client.js";
import { fromE9, fmt, fmtUsd, fmtPct } from "../lib/format.js";
import { deriveProfile } from "../lib/asset-profile.js";
import { CONFIG } from "../lib/config.js";

async function main() {
  console.log(`=== Bluefin Check: ${CONFIG.symbol} ===\n`);

  const client = await createBluefinClient();

  // 1. Ticker
  const ticker = await client.getTickerData(CONFIG.symbol);
  console.log("[Ticker]");
  console.log(`  Mark Price:  ${fmtUsd(fromE9(ticker.markPrice))}`);
  console.log(`  Index Price: ${fmtUsd(fromE9(ticker.indexPrice))}`);
  console.log(`  24h Volume:  ${fmtUsd(fromE9(ticker.volume24h))}`);
  console.log(`  Open Interest: ${fmtUsd(fromE9(ticker.openInterest))}`);
  console.log();

  // 2. Funding Rate History (24h)
  const frHistory = await client.getFundingRateHistory({
    symbol: CONFIG.symbol,
    limit: 24,
  });
  console.log("[Funding Rate - Last 24h]");
  for (const fr of frHistory) {
    const rate = fromE9(fr.fundingRate);
    const time = new Date(fr.timestamp).toISOString().slice(11, 16);
    console.log(`  ${time}: ${fmtPct(rate)}`);
  }
  console.log();

  // 3. Order Book
  const book = await client.getOrderBook({ symbol: CONFIG.symbol, limit: 5 });
  console.log("[Order Book - Top 5]");
  console.log("  Bids:");
  for (const bid of book.bids.slice(0, 5)) {
    console.log(`    ${fmtUsd(fromE9(bid.price))} x ${fmt(fromE9(bid.quantity))}`);
  }
  console.log("  Asks:");
  for (const ask of book.asks.slice(0, 5)) {
    console.log(`    ${fmtUsd(fromE9(ask.price))} x ${fmt(fromE9(ask.quantity))}`);
  }
  console.log();

  // 4. Account
  const account = await client.getAccountInfo();
  console.log("[Account]");
  console.log(`  Balance: ${fmtUsd(fromE9(account.freeBalance))}`);

  const positions = await client.getPositions();
  if (positions.length > 0) {
    console.log("  Positions:");
    for (const pos of positions) {
      console.log(`    ${pos.symbol}: ${pos.side} ${fmt(fromE9(pos.quantity))} @ ${fmtUsd(fromE9(pos.entryPrice))}`);
    }
  } else {
    console.log("  Positions: none");
  }
  console.log();

  // 5. AssetProfile recommendation
  // Note: σ_h を正確に出すには168h candle data が必要。ここでは SUI デフォルト値を使用。
  const profile = deriveProfile({
    symbol: CONFIG.symbol,
    mmr: 0.025,
    maxLeverage: 20,
    makerFee: 0.0001,
    takerFee: 0.00035,
    hourlyVolatility: 0.007,
  });
  console.log("[Recommended Parameters (σ_h=0.70%)]");
  console.log(`  Leverage: ${profile.leverage}x`);
  console.log(`  Neg FR exit: ${profile.negFrHoursExit}h`);
  console.log(`  Margin stop: ${fmtPct(profile.marginStopPct)}`);
  console.log(`  Circuit breaker: ${fmtPct(profile.circuitBreakerPct)}/h`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

> Note: SDK の API メソッド名 (`getTickerData`, `getFundingRateHistory`, `getOrderBook`,
> `getAccountInfo`, `getPositions`) とレスポンス型は SDK 型定義を正として調整すること。
> 上記は Bluefin API docs から推定した疑似コード。

**Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```

SDK 型と合わない箇所を修正。

**Step 3: Test manually with .env (dry: API が返るか確認)**

```bash
npm run check
```

**Step 4: Commit**

```bash
git add src/scripts/check-bluefin.ts
git commit -m "feat: add check-bluefin.ts — ticker, FR, book, account display"
```

---

## Task 5: open-short.ts

**Issue:** #2

**Files:**
- Create: `src/scripts/open-short.ts`

**Step 1: Implement open-short.ts**

CLI args: `--usd`, `--leverage`, `--dry-run`。
USDC deposit → set leverage → market short order。

```typescript
// src/scripts/open-short.ts
import { parseArgs } from "node:util";
import { createBluefinClient } from "../lib/client.js";
import { toE9, fromE9, fmtUsd, fmt } from "../lib/format.js";
import { deriveProfile } from "../lib/asset-profile.js";
import { CONFIG } from "../lib/config.js";

async function main() {
  const { values } = parseArgs({
    options: {
      usd: { type: "string" },
      leverage: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const profile = deriveProfile({
    symbol: CONFIG.symbol,
    mmr: 0.025,
    maxLeverage: 20,
    makerFee: 0.0001,
    takerFee: 0.00035,
    hourlyVolatility: 0.007,
  });

  const usdAmount = Number(values.usd);
  if (!usdAmount || usdAmount <= 0) {
    console.error("Usage: npm run open-short -- --usd <amount> [--leverage <N>] [--dry-run]");
    process.exit(1);
  }

  const leverage = values.leverage ? Number(values.leverage) : profile.leverage;
  const marginAmount = usdAmount / leverage;
  const marginWithBuffer = marginAmount * (1 + profile.marginBufferPct);
  const notional = usdAmount;

  console.log(`=== Open Short: ${CONFIG.symbol} ===`);
  console.log(`  Capital:    ${fmtUsd(usdAmount)}`);
  console.log(`  Leverage:   ${leverage}x`);
  console.log(`  Margin:     ${fmtUsd(marginWithBuffer)} (incl ${(profile.marginBufferPct * 100).toFixed(0)}% buffer)`);
  console.log(`  Notional:   ${fmtUsd(notional)}`);
  console.log(`  Dry run:    ${values["dry-run"]}`);
  console.log();

  if (values["dry-run"]) {
    console.log("[DRY RUN] Would execute the following:");
    console.log(`  1. Deposit ${fmtUsd(marginWithBuffer)} USDC to Bluefin`);
    console.log(`  2. Set leverage to ${leverage}x`);
    console.log(`  3. Market short ${CONFIG.symbol} notional ${fmtUsd(notional)}`);
    return;
  }

  const client = await createBluefinClient();

  // 1. Get current price for quantity calculation
  const ticker = await client.getTickerData(CONFIG.symbol);
  const price = fromE9(ticker.markPrice);
  const quantity = notional / price;

  console.log(`  Price:      ${fmtUsd(price)}`);
  console.log(`  Quantity:   ${fmt(quantity)} SUI`);
  console.log();

  // 2. Deposit USDC
  console.log("[1/3] Depositing USDC...");
  const depositTx = await client.deposit(toE9(marginWithBuffer));
  console.log(`  TX: ${depositTx}`);

  // 3. Set leverage
  console.log(`[2/3] Setting leverage to ${leverage}x...`);
  await client.setLeverage(CONFIG.symbol, toE9(leverage));

  // 4. Place market short
  console.log("[3/3] Placing market short order...");
  const order = await client.createOrder({
    clientOrderId: `open-${Date.now()}`,
    type: "Market",
    symbol: CONFIG.symbol,
    quantityE9: toE9(quantity),
    side: "Short",
    leverageE9: toE9(leverage),
    isIsolated: false,
    reduceOnly: false,
  });
  console.log(`  Order ID: ${order.orderId}`);
  console.log(`  Status:   ${order.status}`);

  // 5. Post-trade summary
  const positions = await client.getPositions();
  const pos = positions.find((p: any) => p.symbol === CONFIG.symbol);
  if (pos) {
    console.log();
    console.log("[Position Summary]");
    console.log(`  Entry Price:       ${fmtUsd(fromE9(pos.entryPrice))}`);
    console.log(`  Quantity:          ${fmt(fromE9(pos.quantity))}`);
    console.log(`  Liquidation Price: ${fmtUsd(fromE9(pos.liquidationPrice))}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

> Note: SDK メソッド名・引数は型定義を正として調整。

**Step 2: Typecheck**

```bash
npx tsc --noEmit
```

**Step 3: Test dry-run**

```bash
npm run open-short -- --usd 50 --dry-run
```

**Step 4: Commit**

```bash
git add src/scripts/open-short.ts
git commit -m "feat: add open-short.ts — USDC deposit + market short"
```

---

## Task 6: close-position.ts

**Issue:** #3

**Files:**
- Create: `src/scripts/close-position.ts`

**Step 1: Implement close-position.ts**

ポジション検出 → reduce-only close → USDC withdraw。

```typescript
// src/scripts/close-position.ts
import { parseArgs } from "node:util";
import { createBluefinClient } from "../lib/client.js";
import { toE9, fromE9, fmtUsd, fmt } from "../lib/format.js";
import { CONFIG } from "../lib/config.js";

async function main() {
  const { values } = parseArgs({
    options: {
      symbol: { type: "string", default: CONFIG.symbol },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const symbol = values.symbol!;
  console.log(`=== Close Position: ${symbol} ===\n`);

  const client = await createBluefinClient();

  // 1. Find position
  const positions = await client.getPositions();
  const pos = positions.find((p: any) => p.symbol === symbol);
  if (!pos) {
    console.log("No open position found.");
    return;
  }

  const quantity = fromE9(pos.quantity);
  const side = pos.side;
  const closeSide = side === "Short" ? "Long" : "Short";

  console.log(`  Current: ${side} ${fmt(quantity)} @ ${fmtUsd(fromE9(pos.entryPrice))}`);
  console.log(`  Close:   ${closeSide} ${fmt(quantity)} (reduce-only)`);
  console.log();

  if (values["dry-run"]) {
    console.log("[DRY RUN] Would execute:");
    console.log(`  1. Reduce-only ${closeSide} market order`);
    console.log(`  2. Withdraw all USDC balance`);
    return;
  }

  // 2. Reduce-only market order
  console.log("[1/2] Closing position...");
  const order = await client.createOrder({
    clientOrderId: `close-${Date.now()}`,
    type: "Market",
    symbol,
    quantityE9: toE9(quantity),
    side: closeSide,
    reduceOnly: true,
  });
  console.log(`  Order ID: ${order.orderId}`);
  console.log(`  Status:   ${order.status}`);

  // 3. Withdraw USDC
  console.log("[2/2] Withdrawing USDC...");
  const account = await client.getAccountInfo();
  const balance = fromE9(account.freeBalance);
  if (balance > 0) {
    const withdrawTx = await client.withdraw(toE9(balance));
    console.log(`  Withdrawn: ${fmtUsd(balance)}`);
    console.log(`  TX: ${withdrawTx}`);
  } else {
    console.log("  No balance to withdraw.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: Typecheck + dry-run test**

```bash
npx tsc --noEmit
npm run close -- --dry-run
```

**Step 3: Commit**

```bash
git add src/scripts/close-position.ts
git commit -m "feat: add close-position.ts — reduce-only close + USDC withdraw"
```

---

## Task 7: watch-fr.ts — Core Monitoring Loop

**Issue:** #6

**Files:**
- Create: `src/scripts/watch-fr.ts`

これは最も複雑なスクリプト。段階的に構築する。

**Step 1: Implement watch-fr.ts — main loop + FR monitoring**

```typescript
// src/scripts/watch-fr.ts
import { parseArgs } from "node:util";
import { createBluefinClient } from "../lib/client.js";
import { fromE9, fmtUsd, fmtPct, fmt } from "../lib/format.js";
import { deriveProfile, type AssetProfile } from "../lib/asset-profile.js";
import { CONFIG } from "../lib/config.js";

// --- State ---
interface WatchState {
  negativeStreakHours: number;
  frHistory7d: number[];        // last 168 hourly FR values
  lastCloseTime: number | null; // timestamp of last auto-close
  positionOpen: boolean;
  totalFrEarned: number;
}

function initialState(): WatchState {
  return {
    negativeStreakHours: 0,
    frHistory7d: [],
    lastCloseTime: null,
    positionOpen: false,
    totalFrEarned: 0,
  };
}

// --- Close Logic ---
async function closePosition(client: any, symbol: string, state: WatchState): Promise<void> {
  const positions = await client.getPositions();
  const pos = positions.find((p: any) => p.symbol === symbol);
  if (!pos) return;

  const quantity = fromE9(pos.quantity);
  const closeSide = pos.side === "Short" ? "Long" : "Short";

  console.log(`[AUTO-CLOSE] Closing ${pos.side} ${fmt(quantity)} ${symbol}`);
  await client.createOrder({
    clientOrderId: `auto-close-${Date.now()}`,
    type: "Market",
    symbol,
    quantityE9: pos.quantity,
    side: closeSide,
    reduceOnly: true,
  });

  state.positionOpen = false;
  state.lastCloseTime = Date.now();
  state.negativeStreakHours = 0;
  console.log(`[AUTO-CLOSE] Position closed at ${new Date().toISOString()}`);
}

// --- Re-Entry Logic ---
async function tryReEntry(
  client: any,
  profile: AssetProfile,
  state: WatchState,
): Promise<void> {
  if (state.positionOpen) return;
  if (!state.lastCloseTime) return;

  const hoursSinceClose = (Date.now() - state.lastCloseTime) / 3_600_000;
  if (hoursSinceClose < profile.reentryWaitHours) return;

  // Check consecutive positive hours
  const recentFr = state.frHistory7d.slice(-profile.reentryPositiveHours);
  if (recentFr.length < profile.reentryPositiveHours) return;
  if (!recentFr.every((fr) => fr > 0)) return;

  // Check 24h rolling avg
  const last24 = state.frHistory7d.slice(-24);
  if (last24.length < 24) return;
  const avg24 = last24.reduce((a, b) => a + b, 0) / last24.length;
  if (avg24 <= 0.000005) return; // 0.0005%

  console.log(`[RE-ENTRY] Conditions met. Opening new short...`);
  // Re-entry uses taker order for immediate fill
  // TODO: Get spot SUI balance, calculate target notional, open short
  console.log(`[RE-ENTRY] TODO: implement taker short order`);
  state.positionOpen = true;
}

// --- Main Loop ---
async function runLoop(client: any, profile: AssetProfile, state: WatchState): Promise<void> {
  const symbol = profile.symbol;
  const now = new Date().toISOString().slice(0, 16);

  // 1. Position health check
  const positions = await client.getPositions();
  const pos = positions.find((p: any) => p.symbol === symbol);
  state.positionOpen = !!pos;

  // 2. Ticker data (price, OI)
  const ticker = await client.getTickerData(symbol);
  const price = fromE9(ticker.markPrice);
  const oi = fromE9(ticker.openInterest);

  // 3. Latest funding rate
  const frData = await client.getFundingRateHistory({ symbol, limit: 1 });
  const latestFr = frData.length > 0 ? fromE9(frData[0].fundingRate) : 0;

  // Update state
  state.frHistory7d.push(latestFr);
  if (state.frHistory7d.length > 168) state.frHistory7d.shift();
  state.totalFrEarned += latestFr;

  if (latestFr < 0) {
    state.negativeStreakHours++;
  } else {
    state.negativeStreakHours = 0;
  }

  // 4. Log
  const avg168 = state.frHistory7d.length > 0
    ? state.frHistory7d.reduce((a, b) => a + b, 0) / state.frHistory7d.length
    : 0;
  const cum7d = state.frHistory7d.reduce((a, b) => a + b, 0);

  console.log(
    `[${now}] FR=${fmtPct(latestFr)} | streak=${state.negativeStreakHours}h neg` +
    ` | 7d_cum=${fmtPct(cum7d)} | 168h_avg=${fmtPct(avg168)}` +
    ` | OI=${fmtUsd(oi)} | price=${fmtUsd(price)}` +
    ` | pos=${state.positionOpen ? "OPEN" : "CLOSED"}`
  );

  // --- Auto-Close Checks (only if position is open) ---
  if (state.positionOpen) {
    // A. Consecutive negative hours
    if (state.negativeStreakHours >= profile.negFrHoursExit) {
      console.log(`[TRIGGER] Negative streak ${state.negativeStreakHours}h >= ${profile.negFrHoursExit}h`);
      await closePosition(client, symbol, state);
      return;
    }

    // B. 7-day cumulative FR
    if (cum7d <= profile.cumulativeFrFloor7d) {
      console.log(`[TRIGGER] 7d cumulative FR ${fmtPct(cum7d)} <= ${fmtPct(profile.cumulativeFrFloor7d)}`);
      await closePosition(client, symbol, state);
      return;
    }

    // C. 168h rolling average
    if (state.frHistory7d.length >= 168 && avg168 <= profile.rollingAvgFrClose) {
      console.log(`[TRIGGER] 168h avg FR ${fmtPct(avg168)} <= ${fmtPct(profile.rollingAvgFrClose)}`);
      await closePosition(client, symbol, state);
      return;
    }

    // D. OI floor
    if (oi < profile.oiFloor) {
      console.log(`[TRIGGER] OI ${fmtUsd(oi)} < floor ${fmtUsd(profile.oiFloor)}`);
      await closePosition(client, symbol, state);
      return;
    }

    // E. Circuit breaker (price change check)
    // TODO: Compare with previous hour's price for circuit breaker

    // F. Margin health check
    if (pos) {
      const account = await client.getAccountInfo();
      const marginRatio = fromE9(account.marginRatio ?? "0");
      if (marginRatio > 0 && marginRatio < 0.12) {
        console.log(`[MARGIN] Low margin ratio ${fmtPct(marginRatio)} — needs top-up`);
      }
    }

    // G. Delta check (diagnostic)
    if (pos) {
      const posNotional = fromE9(pos.quantity) * price;
      // TODO: Get spot SUI balance for delta calculation
      console.log(`  short_notional=${fmtUsd(posNotional)}`);
    }
  }

  // --- Re-Entry Check (only if position is closed) ---
  if (!state.positionOpen) {
    await tryReEntry(client, profile, state);
  }
}

// --- Entry Point ---
async function main() {
  const { values } = parseArgs({
    options: {
      interval: { type: "string", default: "3600" },
    },
  });

  const intervalMs = Number(values.interval) * 1000;

  const profile = deriveProfile({
    symbol: CONFIG.symbol,
    mmr: 0.025,
    maxLeverage: 20,
    makerFee: 0.0001,
    takerFee: 0.00035,
    hourlyVolatility: 0.007,
  });

  console.log(`=== Watch FR: ${profile.symbol} ===`);
  console.log(`  Interval:        ${intervalMs / 1000}s`);
  console.log(`  Neg FR exit:     ${profile.negFrHoursExit}h`);
  console.log(`  7d FR floor:     ${fmtPct(profile.cumulativeFrFloor7d)}`);
  console.log(`  Margin stop:     ${fmtPct(profile.marginStopPct)}`);
  console.log(`  Circuit breaker: ${fmtPct(profile.circuitBreakerPct)}/h`);
  console.log(`  Re-entry wait:   ${profile.reentryWaitHours}h`);
  console.log();

  const client = await createBluefinClient();
  const state = initialState();

  // Initial run
  await runLoop(client, profile, state);

  // Recurring loop
  setInterval(async () => {
    try {
      await runLoop(client, profile, state);
    } catch (err) {
      console.error(`[ERROR] ${err}`);
    }
  }, intervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: Typecheck**

```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/scripts/watch-fr.ts
git commit -m "feat: add watch-fr.ts — FR monitoring, auto-close, re-entry logic"
```

---

## Task 8: Docker Configuration

**Issue:** #5

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

**Step 1: Create Dockerfile**

```dockerfile
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src/ src/

# tsx for direct TS execution
RUN npm install -g tsx

CMD ["tsx", "src/scripts/watch-fr.ts"]
```

**Step 2: Create docker-compose.yml**

```yaml
services:
  watch:
    build: .
    command: tsx src/scripts/watch-fr.ts
    restart: unless-stopped
    env_file: .env
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  cli:
    build: .
    profiles: [cli]
    env_file: .env
    entrypoint: ["tsx"]
```

**Step 3: Create .dockerignore**

```
node_modules
dist
.env
.git
docs
*.md
```

**Step 4: Test Docker build**

```bash
docker compose build
```

**Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: add Docker configuration for GCE deployment"
```

---

## Task 9: E2E Verification ($50 test)

**Issue:** #5

**Step 1: Check environment**

```bash
npm run check
```

Verify: ticker, FR, book, account all display correctly.

**Step 2: Small test open**

```bash
npm run open-short -- --usd 50 --dry-run
```

Review output. If correct:

```bash
npm run open-short -- --usd 50
```

**Step 3: Verify position**

```bash
npm run check
```

Confirm: position appears with correct size/leverage.

**Step 4: Monitor briefly**

```bash
npm run watch -- --interval 60
```

Run for a few minutes. Verify FR logging, margin check, delta output.

**Step 5: Close test position**

```bash
npm run close
```

Verify: position closed, USDC withdrawn.

**Step 6: Commit state if any adjustments made**

```bash
git add -u
git commit -m "fix: SDK integration adjustments from E2E testing"
```

---

## Summary: Issue → Task Mapping

| Task | Issue | Description | Depends on |
|---|---|---|---|
| 1 | #7 | Project init | — |
| 2 | #7 | Shared lib (config, format, client) | Task 1 |
| 3 | #7 | AssetProfile (σ_h derivation + tests) | Task 1 |
| 4 | #7 | check-bluefin.ts | Tasks 2, 3 |
| 5 | #2 | open-short.ts | Tasks 2, 3 |
| 6 | #3 | close-position.ts | Task 2 |
| 7 | #6 | watch-fr.ts | Tasks 2, 3, 5, 6 |
| 8 | #5 | Docker configuration | Task 7 |
| 9 | #5 | E2E verification ($50) | All above |
