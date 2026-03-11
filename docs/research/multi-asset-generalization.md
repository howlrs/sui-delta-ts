# Multi-Asset Generalization: Delta-Neutral FR Strategy

## 1. Bluefin Market Landscape (March 2026)

Bluefin currently offers **4 standard perpetual markets** plus occasional pre-launch markets:

| Market | IMR | MMR | Max Lev | Maker | Taker | Default Lev |
|--------|-----|-----|---------|-------|-------|-------------|
| BTC-PERP | 4.5% | 1.75% | 20x | 0.01% | 0.035% | 3x |
| ETH-PERP | 4.5% | 1.75% | 20x | 0.01% | 0.035% | 3x |
| SOL-PERP | 4.5% | 1.75% | 20x | 0.01% | 0.035% | 10x |
| SUI-PERP | 4.5% | 2.5% | 20x | 0.01% | 0.035% | 10x |

Pre-launch markets (e.g., SEND-PERP) have drastically different specs: 60% IMR, 1x leverage only, 0.25% taker fee. These are **unsuitable** for the FR strategy.

**Funding rate mechanics are uniform**: hourly, cap +/-0.1%/h, same formula across all markets. No asset-specific FR parameters.

Bluefin has announced plans to expand to ~100 perp markets. When mid/small-cap perps (WAL, DEEP, BLUE, etc.) launch, they will likely have higher MMR, lower max leverage, and thinner books -- making the generalization problem real.

---

## 2. What Changes With Higher Volatility

The delta-neutral math (short notional = spot notional) is identical regardless of asset. What changes is everything around the edges:

### 2a. Margin Health Deterioration Rate

At 10x leverage with 10% margin, a price move of X% causes unrealized PnL swing of 10*X% against margin. The **time to danger** scales inversely with volatility:

| Asset Class | Daily Vol (1σ) | Hourly Vol (1σ) | Hours to 8% margin move | Hours to liquidation (~MMR) |
|-------------|---------------|-----------------|------------------------|---------------------------|
| BTC | 2-3% | 0.3-0.4% | ~22h | ~50h |
| ETH | 3-5% | 0.4-0.6% | ~15h | ~35h |
| SUI | 5-6% | 0.6-0.8% | ~11h | ~25h |
| High-vol alt | 8-15% | 1.0-1.9% | ~5h | ~10h |

*Assumes 10x leverage; hours are approximate 1σ expectations, tail events can be 3-4σ.*

**Implication**: The 18h consecutive-negative-FR threshold was calibrated for SUI where you have ~25h before liquidation becomes a concern. For a high-vol alt, you might have only 10h -- the threshold must shrink.

### 2b. Naked Period Risk

When the short is closed due to FR deterioration, spot sits unhedged. The expected drift during a naked period of T hours:

```
Expected naked exposure (1σ) = spot_value * hourly_vol * sqrt(T)
```

| Asset | 6h naked (1σ) | 12h naked (1σ) | 24h naked (1σ) |
|-------|--------------|----------------|----------------|
| BTC ($3K spot) | $22 (0.7%) | $31 (1.0%) | $44 (1.5%) |
| SUI ($3K spot) | $44 (1.5%) | $62 (2.1%) | $88 (2.9%) |
| High-vol alt ($3K) | $88 (2.9%) | $124 (4.1%) | $176 (5.9%) |

**Implication**: The 6h+12h (18h total) re-entry wait works for SUI (~2.1% expected move). For a high-vol alt, 18h naked means ~5% expected move, which creates meaningful rebalancing cost and margin mismatch.

### 2c. Funding Rate Characteristics by Volatility

Higher-vol assets typically have:
- **Higher average FR** (compensation for carrying risk) -- good for yield
- **More volatile FR** (wider swings between positive and negative)
- **Longer and deeper negative streaks** (momentum-driven liquidation cascades)
- **More frequent FR spikes** (both directions)

This means the exits are triggered more often, but the yield between exits is also higher. The key question is whether the extra yield compensates for the extra cost of exits.

### 2d. Orderbook Depth & Slippage

For a $3K position, slippage is negligible on BTC/ETH/SOL/SUI (all have >$700K within 1% of mid). For future small-cap perps, the book might be $50-200K thin, meaning:
- Market orders on $3K = 0.1-0.5% slippage
- Need to use maker orders (already planned)
- Position open/close takes longer (partial fills)

---

## 3. Parameter Classification

### 3a. Parameters That MUST Be Asset-Specific

These parameters depend on the asset's volatility, liquidity, or exchange-imposed specs:

| Parameter | Why Asset-Specific | Derivation |
|-----------|-------------------|------------|
| **Leverage** | Higher vol needs lower leverage for same margin safety | Formula below |
| **Margin buffer %** | Absorbs larger unrealized PnL swings | Formula below |
| **Consecutive negative FR hours (exit threshold)** | Must exit before margin danger zone | Formula below |
| **7-day cumulative FR floor (exit threshold)** | Scales with expected negative FR severity | Formula below |
| **Re-entry wait time** | Longer wait = larger naked exposure; must balance | Formula below |
| **Re-entry consecutive positive hours** | More volatile FR needs more confirmation | Formula below |
| **OI floor ($)** | Minimum OI to ensure position can be filled/exited | Formula below |
| **Delta rebalance tolerance %** | Tighter for high-vol (drift grows faster) | Formula below |

### 3b. Parameters That Can Stay Universal

| Parameter | Value | Why Universal |
|-----------|-------|---------------|
| Funding check interval | 1h | Bluefin FR is hourly for all markets |
| Order type | Maker (limit) | Always cheaper, all markets support it |
| Rebalance method | Single-leg (resize short) | Architecture doesn't change by asset |
| Margin health check interval | 1h (aligned with FR) | Sufficient for all vol levels at recommended leverage |
| Spot anchor principle | Keep spot, adjust short | Universal best practice |
| FR cap awareness | +/-0.1%/h | Bluefin-wide constant |

### 3c. Parameters That Are Exchange-Imposed (Read, Don't Set)

| Parameter | Source |
|-----------|--------|
| IMR | Bluefin contract specs per market |
| MMR | Bluefin contract specs per market |
| Max leverage | Bluefin contract specs per market |
| Maker/Taker fees | Bluefin contract specs per market |
| FR cap | Bluefin (currently 0.1%/h all markets) |

---

## 4. Derivation Formulas for Asset-Specific Parameters

All formulas below use one primary observable input: **realized hourly volatility (σ_h)**, measured as the standard deviation of hourly log returns over a trailing window (168h = 7 days recommended).

Secondary inputs: exchange-imposed MMR, and observed orderbook depth.

### 4a. Leverage Selection

**Goal**: Ensure that a 3σ daily move does not push margin ratio below MMR + safety buffer.

```
max_safe_leverage = 1 / (3 * σ_daily + MMR + 0.02)

where:
  σ_daily = σ_h * sqrt(24)
  MMR = exchange maintenance margin ratio
  0.02 = 2% safety cushion above MMR

Recommended leverage = floor(min(max_safe_leverage, exchange_max_leverage))
```

| Asset | σ_h | σ_daily | MMR | max_safe_lev | Recommended |
|-------|-----|---------|-----|-------------|-------------|
| BTC | 0.35% | 1.7% | 1.75% | 14.6x | 14x |
| ETH | 0.50% | 2.4% | 1.75% | 11.3x | 11x |
| SUI | 0.70% | 3.4% | 2.50% | 7.3x | 7x |
| High-vol | 1.20% | 5.9% | 2.50%* | 4.3x | 4x |

*Assumed MMR for hypothetical high-vol market; Bluefin may impose higher.

**Note**: Current SUI strategy uses 10x. The formula suggests 7x is safer. At $3K capital, 10x gives $2,727 notional (91% FR exposure); 7x gives $2,625 notional (87.5% FR exposure). The yield difference is small (~0.4% APY) but margin safety improves significantly. Consider using the formula output but with a configurable `leverage_aggression` multiplier (default 1.0, range 0.8-1.3) for user preference.

### 4b. Margin Buffer

**Goal**: Maintain enough excess margin that a 2σ hourly move doesn't trigger margin top-up.

```
margin_buffer_pct = max(15%, 3 * σ_h * leverage * 100)

Clamped to range [15%, 40%]
```

| Asset | σ_h | Leverage | Buffer |
|-------|-----|----------|--------|
| BTC | 0.35% | 14x | 15% (floor) |
| ETH | 0.50% | 11x | 16.5% |
| SUI | 0.70% | 7x | 15% (floor) |
| High-vol | 1.20% | 4x | 15% (floor) |

At recommended leverage levels, the 15% floor is generally sufficient. The buffer becomes critical if the user overrides to higher leverage.

### 4c. Consecutive Negative FR Hours (Exit Threshold)

**Goal**: Exit before cumulative negative FR + margin deterioration from price moves creates danger. Scale with volatility -- more volatile = exit sooner.

The SUI baseline: 18h threshold based on max observed streak of 17h. The key insight is that longer negative FR streaks correlate with trending markets (directional price moves), so margin health deteriorates simultaneously.

```
neg_fr_hours = floor(18 * (σ_h_SUI / σ_h_asset))

where σ_h_SUI = 0.70% (reference)

Clamped to range [6, 36]
```

| Asset | σ_h | neg_fr_hours |
|-------|-----|-------------|
| BTC | 0.35% | 36 |
| ETH | 0.50% | 25 |
| SUI | 0.70% | 18 (reference) |
| High-vol | 1.20% | 10 |

**Rationale**: BTC can tolerate longer negative streaks because margin deteriorates slower. High-vol assets must exit fast.

### 4d. 7-Day Cumulative FR Floor (Exit Threshold)

**Goal**: Exit if cumulative 7-day FR becomes sufficiently negative that continued exposure is unprofitable after accounting for risk.

SUI baseline: -0.50% (roughly 1.8x worst observed -0.279%).

```
cumulative_fr_floor_7d = -0.50% * (σ_h_asset / σ_h_SUI)

Clamped to range [-2.0%, -0.20%]
```

| Asset | σ_h | 7d FR floor |
|-------|-----|------------|
| BTC | 0.35% | -0.25% |
| ETH | 0.50% | -0.36% |
| SUI | 0.70% | -0.50% (reference) |
| High-vol | 1.20% | -0.86% |

**Note**: Higher-vol assets get a *wider* (more negative) floor because their normal positive FR is also higher -- you can tolerate more negative accumulation before the trade is structurally broken. This seems counterintuitive but is correct: the threshold should reflect "is the FR regime broken?" not "has FR been negative?"

### 4e. Re-Entry Parameters

**Re-entry consecutive positive hours**:
```
reentry_positive_hours = max(4, floor(6 * (σ_h_asset / σ_h_SUI)))

Clamped to range [4, 12]
```

More volatile assets need more FR confirmation because their FR flips more often (reduces false re-entries).

**Re-entry wait time after positive confirmation**:
```
reentry_wait_hours = max(6, floor(12 * (σ_h_SUI / σ_h_asset)))

Clamped to range [6, 24]
```

Lower vol assets wait longer (their FR regimes are stickier, so waiting is cheap). Higher vol assets wait shorter (naked exposure cost is high).

| Asset | σ_h | Positive hours needed | Wait after | Total re-entry time |
|-------|-----|--------------------|-----------|-------------------|
| BTC | 0.35% | 4 | 24h | 28h |
| ETH | 0.50% | 5 | 17h | 22h |
| SUI | 0.70% | 6 | 12h | 18h (reference) |
| High-vol | 1.20% | 10 | 7h | 17h |

**Interesting result**: Total re-entry time is roughly similar across assets, but the composition shifts. BTC: short confirmation, long wait (FR regimes are stable). High-vol: long confirmation, short wait (FR flips often, but naked cost is high).

### 4f. OI Floor

**Goal**: Ensure position can be entered/exited without moving the market. Rule of thumb: position should be <2% of OI.

```
oi_floor = max(200_000, position_notional / 0.02)

For $3K capital at recommended leverage:
  BTC: $2,786 notional → OI floor = $200K (binding minimum)
  High-vol: $2,250 notional → OI floor = $200K (binding minimum)
```

At $3K capital, the $200K floor is almost always binding. Scale this if capital grows:
```
oi_floor = max(200_000, total_capital * recommended_leverage / 0.02)
```

### 4g. 168h Rolling Average FR Close Threshold

**Goal**: Detect FR regime shift to structurally low/negative.

```
rolling_avg_fr_close = avg_hourly_fr * 0.0  (i.e., close at break-even)
```

This stays at 0.0000% universally. If average FR over 168h is negative, the trade is losing money regardless of asset. No need to scale.

### 4h. Delta Rebalance Tolerance

```
delta_tolerance_pct = max(2%, min(5%, 3% * (σ_h_SUI / σ_h_asset)))

```

| Asset | σ_h | Delta tolerance |
|-------|-----|----------------|
| BTC | 0.35% | 5% (cap) |
| ETH | 0.50% | 4.2% |
| SUI | 0.70% | 3% (reference) |
| High-vol | 1.20% | 2% (floor) |

Higher-vol assets need tighter rebalancing because drift accumulates faster.

### 4i. Margin Stop (Maximum Acceptable Margin Loss)

**Revised**: Old formula (-15% for SUI) triggered at +2.9% price move, which fires
almost daily given SUI's 3.4% daily volatility. In a delta-neutral strategy, short-side
losses are offset by spot gains, so the margin stop should protect against Bluefin
liquidation only — not react to normal price noise.

```
margin_stop_pct = -1 * min(60%, max(30%, 50% * (σ_h_asset / σ_h_SUI)))

```

| Asset | σ_h | Margin stop | Trigger price Δ | Est. frequency | Buffer to liquidation |
|-------|-----|------------|-----------------|----------------|----------------------|
| BTC | 0.35% | -30% (floor) | ~+2.1% | Weekly | - |
| ETH | 0.50% | -36% | ~+5% | Monthly | - |
| SUI | 0.70% | -50% (reference) | ~+9.8% | <1x/month | 6.9% |
| High-vol | 1.20% | -60% (cap) | ~+15% | Rare | 1.7% |

---

## 5. Configuration Architecture

### 5a. Per-Asset Config Structure

```typescript
interface AssetProfile {
  // Identity
  symbol: string;               // e.g., "SUI-PERP"
  spotSymbol: string;           // e.g., "SUI" (for spot leg)

  // Exchange-imposed (read from API on startup)
  imr: number;                  // Initial margin ratio (e.g., 0.045)
  mmr: number;                  // Maintenance margin ratio (e.g., 0.025)
  maxLeverage: number;          // Exchange max (e.g., 20)
  makerFee: number;             // e.g., 0.0001
  takerFee: number;             // e.g., 0.00035

  // Observable (computed from market data, updated periodically)
  hourlyVolatility: number;     // σ_h: trailing 168h realized vol
  currentOI: number;            // Open interest in USD
  spreadBps: number;            // Typical bid-ask spread in bps

  // Derived (auto-calculated from observables using formulas above)
  leverage: number;
  marginBufferPct: number;
  negFrHoursExit: number;
  cumulativeFrFloor7d: number;
  reentryPositiveHours: number;
  reentryWaitHours: number;
  oiFloor: number;
  deltaTolerancePct: number;
  marginStopPct: number;

  // Universal (same for all assets)
  rollingAvgFrClose: number;    // 0.0000
  frCheckIntervalMs: number;    // 3_600_000 (1h)
}
```

### 5b. Config Initialization Flow

```
Startup:
  1. Read exchange specs via API (IMR, MMR, fees) for target asset
  2. Fetch 168h of hourly candles → compute σ_h
  3. Fetch current OI and orderbook → compute spread
  4. Apply formulas from Section 4 to derive all parameters
  5. Apply user overrides (if any)
  6. Validate: reject if OI < oiFloor or leverage < 2x
  7. Log full config for auditability

Runtime (every 24h):
  1. Recompute σ_h from latest 168h
  2. Recompute derived parameters
  3. If any parameter changes by >20%, log warning
  4. Apply changes (gradual, not abrupt)
```

### 5c. User Override Layer

Users can override any derived parameter. Overrides are validated against safety bounds:

```typescript
interface UserOverrides {
  leverage?: number;              // Validated: <= maxLeverage, >= 2
  marginBufferPct?: number;       // Validated: >= 10%
  negFrHoursExit?: number;        // Validated: [4, 48]
  cumulativeFrFloor7d?: number;   // Validated: [-3%, -0.1%]
  reentryPositiveHours?: number;  // Validated: [2, 18]
  reentryWaitHours?: number;      // Validated: [3, 48]
  marginStopPct?: number;         // Validated: [-30%, -5%]
  deltaTolerancePct?: number;     // Validated: [1%, 8%]
}
```

### 5d. Preset Profiles (Quick Start)

For users who don't want to think about parameters:

```typescript
const PRESETS: Record<string, Partial<UserOverrides>> = {
  conservative: {
    // Lower leverage, wider exits, longer re-entry
    // leverageAggression: 0.8 (applied as multiplier to formula output)
  },
  balanced: {
    // Formula defaults, no overrides
  },
  aggressive: {
    // Higher leverage, tighter exits, shorter re-entry
    // leverageAggression: 1.2
  },
};
```

---

## 6. New Risks for High-Volatility Tokens

### 6a. Liquidation Cascade Risk

On thin-book assets, a large liquidation (not ours) can cascade: liquidation -> price spike -> more liquidations -> flash crash/pump. This can move price 10-20% in minutes.

**Mitigation**: Lower leverage (formula handles this). Additionally, set a **price circuit breaker**: if price moves >3σ_h in a single candle, immediately close all positions regardless of FR status.

```
circuit_breaker_pct = 3 * σ_h * 100

BTC: 1.05% (per hour)
SUI: 2.10% (per hour)
High-vol: 3.60% (per hour)
```

### 6b. Funding Rate Spikes

FR can hit the cap (+/-0.1%/h = +/-2.4%/day) during extreme conditions. On high-vol assets this happens more frequently.

**Mitigation**: Already handled -- the 0.1%/h cap is Bluefin-wide. At 10x leverage, one hour of -0.1% FR costs 0.1% of margin. At recommended 4x for high-vol, it costs 0.4% of notional = 1.6% of margin. Painful but not dangerous over a few hours.

### 6c. Gap Risk (Price Jumps Past Liquidation)

On thin books, price can gap through the liquidation level. Bluefin uses oracle-based liquidation (not last traded price), which provides some protection, but extreme moves can still cause losses beyond margin.

**Mitigation**: Lower leverage (handled). Keep position size small relative to OI (OI floor check). Accept that this is a tail risk -- at $3K capital, maximum loss is bounded.

### 6d. Auto-Deleveraging (ADL)

When the insurance fund is insufficient, Bluefin can auto-deleverage profitable positions. This would forcibly close our short at a profit, leaving us naked long.

**Mitigation**: Monitor for ADL events via websocket. If ADL triggers, immediately sell spot to flatten. ADL is rare on established markets but more likely on new, thin markets.

### 6e. Slippage on Close

Thin orderbook means closing a $3K position might cost 10-50 bps in slippage.

**Mitigation**: Use maker orders (already planned). Accept longer time-to-fill. Set a **max slippage** parameter:

```
max_slippage_bps = max(5, spreadBps * 2)
```

If estimated slippage exceeds this, use partial close over multiple intervals.

---

## 7. Profitability Expectations by Asset

Rough annual yield estimates at $3K capital:

| Asset | Leverage | Notional | Est. Avg FR (APY) | LST Yield | Gross | Est. Exits/Year | Exit Cost (maker) | Net APY |
|-------|----------|----------|-------------------|-----------|-------|-----------------|-------------------|---------|
| BTC | 14x | $2,786 | 5-8% | 0% (no LST) | 5-8% | 3-5 | ~$3 | 4.9-7.9% |
| ETH | 11x | $2,727 | 6-10% | 3% (stETH) | 9-13% | 5-8 | ~$4 | 8.8-12.8% |
| SUI | 7x | $2,625 | 9-10% | 3% (vSUI) | 12-13% | 8-12 | ~$5 | 11.7-12.7% |
| High-vol | 4x | $2,400 | 12-20%?* | 0%** | 12-20% | 15-25 | ~$15 | 11.5-19.5% |

*High-vol FR data is speculative; no Bluefin history exists for these markets yet.
**Most small-cap tokens have no liquid staking.

**Key insight**: SUI is currently the sweet spot on Bluefin -- high FR (structural positive bias), LST yield available, and sufficient liquidity. BTC/ETH have lower FR on Bluefin specifically (different from Binance). High-vol tokens offer potentially higher FR but with no LST yield and much higher operational risk.

---

## 8. Implementation Priority

Given that Bluefin currently only has 4 perp markets (BTC, ETH, SOL, SUI), and the strategy is already designed for SUI:

### Phase 1: Ship SUI (current)
- Hardcoded SUI parameters (already designed)
- Get the system running and validated

### Phase 2: Extract Config Layer
- Refactor hardcoded params into `AssetProfile` interface
- Implement the derivation formulas
- Add config validation
- Test with ETH-PERP and SOL-PERP (both have spot legs available on Sui)

### Phase 3: Multi-Asset Support
- Runtime asset switching
- Per-asset monitoring dashboards
- Portfolio-level capital allocation (split $3K across assets? or focus on highest-yielding?)

### Phase 4: Auto-Calibration (if needed)
- Periodic σ_h recomputation
- Parameter auto-adjustment
- Alerting on regime changes

**Recommendation**: Start Phase 2 only when Bluefin adds more markets or when the SUI strategy is profitable and validated in production. The config extraction is a low-cost refactor that pays off when the exchange grows.

---

## 9. Summary: Complete Parameter Table

Reference table with all formulas. `σ_r` = `σ_h_asset / σ_h_SUI` (relative volatility ratio, SUI = 1.0).

| Parameter | Formula | SUI (σ_r=1.0) | BTC (σ_r=0.5) | High-vol (σ_r=1.7) | Bounds |
|-----------|---------|---------------|---------------|-------------------|--------|
| Leverage | `floor(1/(3*σ_d + MMR + 0.02))` | 7x | 14x | 4x | [2, max_lev] |
| Margin buffer | `max(15%, 3*σ_h*lev*100)` | 15% | 15% | 15% | [15%, 40%] |
| Neg FR hours exit | `floor(18 / σ_r)` | 18 | 36 | 10 | [6, 36] |
| 7d cum FR floor | `-0.50% * σ_r` | -0.50% | -0.25% | -0.86% | [-2%, -0.2%] |
| Re-entry positive h | `max(4, floor(6 * σ_r))` | 6 | 4 | 10 | [4, 12] |
| Re-entry wait h | `max(6, floor(12 / σ_r))` | 12 | 24 | 7 | [6, 24] |
| OI floor | `max(200K, notional/0.02)` | $200K | $200K | $200K | [$200K, inf] |
| Delta tolerance | `max(2%, min(5%, 3%/σ_r))` | 3% | 5% | 2% | [2%, 5%] |
| Margin stop | `-min(60%, max(30%, 50%*σ_r))` | -50% | -30% | -60% | [-60%, -30%] |
| Rolling avg FR close | `0.0000%` | 0.0000% | 0.0000% | 0.0000% | universal |
| Circuit breaker | `3 * σ_h * 100` | 2.1%/h | 1.05%/h | 3.6%/h | per-hour |

**The single most important input is hourly realized volatility (σ_h).** Everything else derives from it.

---

## Sources

- [Bluefin Contract Specs](https://learn.bluefin.io/bluefin/bluefin-perps-exchange/trading/contract-specs)
- [Bluefin Funding Rate Docs](https://learn.bluefin.io/bluefin/bluefin-perps-exchange/trading/funding)
- [Bluefin Pre-Launch Markets](https://learn.bluefin.io/bluefin/bluefin-perps-exchange/pre-launch-markets)
- [Bluefin Risk Engine](https://learn.bluefin.io/bluefin/bluefin-perps-exchange/trading/risk-engine)
- [CoinGlass Funding Rate Comparison](https://www.coinglass.com/FundingRate)
- [Keyrock: Navigating Bluefin](https://keyrock.com/navigating-bluefin-and-future-perpetual-dexes/)
