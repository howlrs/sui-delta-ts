# Delta-Neutral Funding Rate Strategy — Design Document

## 1. Overview

Bluefin SUI-PERP short (FR capture) + Spot SUI (LST) によるデルタニュートラル戦略。
$3,000 の資金を年率 ~12% (FR 9.3% + LST 3%) で運用する。

### Target

- Exchange: Bluefin (Sui-native perp DEX)
- Market: SUI-PERP (構造的 FR 優位、LST yield、bridge risk ゼロ)
- Capital: $3,000
- Expected net APY: ~12%
- Expected annual income: ~$336

### Why SUI-PERP

隠れコスト分析の結果、Bluefin 4市場中 SUI-PERP が圧倒的最適。

| Factor | SUI | BTC/ETH/SOL |
|---|---|---|
| FR APY | +9.3% (実測 1000h) | +2-7% (推定) |
| LST yield | +3% (vSUI) | 0% (Sui上にLSTなし) |
| Bridge risk | なし (native) | wBTC/wETH/wSOL bridge必要 |
| Exit liquidity | $50M+ | $50K-2M |

## 2. Architecture

```
src/
  lib/
    client.ts         — Bluefin SDK 初期化・認証
    config.ts         — 環境変数・定数
    format.ts         — E9 変換・表示ヘルパー
    asset-profile.ts  — σ_h → パラメータ自動導出
  scripts/
    check-bluefin.ts  — 状態確認 (手動)
    open-short.ts     — ポジション建て (手動)
    close-position.ts — 決済 (手動/自動)
    watch-fr.ts       — FR監視・自動決済 (常駐)
Dockerfile
docker-compose.yml
.env.example
.gitignore
```

- **watch-fr.ts** → Docker 常駐サービス (GCE)
- **check / open / close** → `docker compose run --rm cli <command>` ワンショット実行
- **Runtime**: tsx (TypeScript direct execution)
- **SDK**: `@bluefin-exchange/pro-sdk` v1.13.0 + `@mysten/sui` v1.x

## 3. Capital Allocation

$3,000, AssetProfile 導出レバレッジ (SUI: 7x)

| Allocation | Amount | Role | Yield |
|---|---|---|---|
| Spot SUI → vSUI | $2,625 (87.5%) | Delta hedge + LST | 3.0% |
| Bluefin margin (+ 15% buffer) | $375 → ~$431 | Short collateral | 0% |
| Short notional | $2,625 | FR target | 9.3% |

UserOverrides で 10x leverage に変更可能 (margin $263 → $302)。

## 4. AssetProfile — σ_h Based Parameter Derivation

全パラメータは σ_h (168h hourly realized volatility) から導出。
汎用設計により SUI 以外のトークンにも対応可能。

```typescript
interface AssetProfile {
  symbol: string;
  // Exchange-imposed
  imr: number; mmr: number; maxLeverage: number;
  makerFee: number; takerFee: number;
  // Observable
  hourlyVolatility: number; // σ_h
  currentOI: number; spreadBps: number;
  // Derived
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
}
```

### Derivation Formulas (σ_r = σ_h / σ_h_SUI)

| Parameter | Formula | SUI | BTC | High-vol |
|---|---|---|---|---|
| Leverage | floor(1/(3σ_d + MMR + 0.02)) | 7x | 14x | 4x |
| Neg FR hours | floor(18/σ_r) | 18 | 36 | 10 |
| 7d FR floor | -0.50% × σ_r | -0.50% | -0.25% | -0.86% |
| Re-entry positive h | max(4, floor(6×σ_r)) | 6 | 4 | 10 |
| Re-entry wait h | max(6, floor(12/σ_r)) | 12 | 24 | 7 |
| Margin stop | -min(60%, max(30%, 50%×σ_r)) | -50% | -30% | -60% |
| Circuit breaker | 3 × σ_h × 100 | 2.1%/h | 1.05%/h | 3.6%/h |

## 5. Watch-FR Monitoring Design

### Normal Operation (1h interval)

```
1. Position health check (API)
2. Margin ratio: < 12% → top up, > 25% → withdraw
3. FR check → auto-close evaluation
4. Circuit breaker: price > 3×σ_h → immediate close
5. Delta log (should be ~0%; > 1% → alert)
6. 168h rolling avg FR + OI regime monitoring
```

### Auto-Close Triggers

```
negative_consecutive_hours >= negFrHoursExit (SUI: 18h)
cumulative_fr_loss_7d >= cumulativeFrFloor7d (SUI: -0.50%)
unrealized_pnl_margin <= marginStopPct (SUI: -50%)
rolling_168h_avg_fr < 0.0000%/h (universal)
open_interest < oiFloor (SUI: $200K)
hourly_price_change > circuitBreakerPct (SUI: 2.1%)
```

### Re-Entry After Auto-Close

```
Conditions:
  - reentryPositiveHours consecutive positive (SUI: 6h)
  - 24h avg FR > +0.0005%/h
  - reentryWaitHours elapsed since exit (SUI: 12h)

Procedure:
  1. spot_tokens × current_price = target_short_notional
  2. required_margin = target / leverage
  3. Margin check → insufficient = alert
  4. TAKER order (instant fill, ~$2.73 cost)
```

Taker order を使用する理由: maker は adverse selection 問題。
naked exposure 中に 1% 逆行 = $27 損失 >> taker 追加コスト $2.59。

### Key Insight: Delta Does Not Drift During Normal Ops

同じトークン枚数の spot + short ならデルタは価格変動でゼロのまま。
定常リバランスは不要。監視すべきは margin health のみ。

## 6. Order Execution Strategy

| Scenario | Order Type | Rationale |
|---|---|---|
| Initial position open | Maker | Time constraint なし, $0.14 |
| Normal rebalance | Not needed | Delta is structurally zero |
| Re-entry after close | Taker | Naked exposure risk >> fee |
| Emergency close | Taker | Speed critical |

## 7. Risk Matrix

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| FR regime change | Medium | Revenue -50% | 168h rolling avg, close at 0% |
| FR temporary negative | High (1-2x/mo) | Minor | 18h tolerance, 2.4d recovery |
| Price flash crash/pump | Low-Medium | Liquidation | Circuit breaker 3×σ_h |
| Bluefin downtime | Low | Trade blocked | Funds on-chain |
| USDC.e depeg | Very low | High | Wormhole dependency |
| Liquidation (7x) | Low | Margin loss | σ_h-derived leverage + 15% buffer |
| ADL (auto-deleverage) | Very low | Forced close | OI monitoring, position size limits |

## 8. Docker Deployment (GCE)

```yaml
# docker-compose.yml
services:
  watch:
    build: .
    command: npx tsx src/scripts/watch-fr.ts
    restart: unless-stopped
    env_file: .env
  cli:
    build: .
    profiles: [cli]
    env_file: .env
```

- `docker compose up -d watch` — FR 監視常駐
- `docker compose run --rm cli npx tsx src/scripts/check-bluefin.ts` — ワンショット

## 9. Implementation Phases

### Phase 1: Core (SUI-PERP)
- Project init + shared lib
- check-bluefin.ts
- open-short.ts
- close-position.ts
- watch-fr.ts
- Docker configuration
- E2E test ($50)

### Phase 2: Generalization
- σ_h auto-calculation from candle data
- AssetProfile parameter derivation
- `--symbol` CLI flag for multi-asset
- ETH-PERP / SOL-PERP testing

### Phase 3: Production Hardening
- GCE deployment
- Alert notification (Discord/Telegram)
- Monthly review automation

## 10. References

- [Bluefin Pro SDK](https://www.npmjs.com/package/@bluefin-exchange/pro-sdk)
- [Bluefin API Docs](https://bluefin-exchange.readme.io/reference)
- [Bluefin Contract Specs](https://learn.bluefin.io/bluefin/bluefin-perps-exchange/trading/contract-specs)
- docs/strategy-overview.md — 1000h FR data analysis
- docs/research/multi-asset-generalization.md — σ_h parameter derivation
- docs/research/rebalancing-after-hedge-reentry.md — Industry rebalancing patterns
