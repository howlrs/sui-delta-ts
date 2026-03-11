# Delta-Neutral Rebalancing After Hedge Removal/Re-Entry

## Research Summary

How established delta-neutral protocols and professional desks handle the exact problem we face: short leg closed (FR deterioration) -> naked spot exposure -> re-entry at different price -> spot/short size mismatch.

---

## 1. Ethena (USDe) — The Institutional Benchmark

**Scale**: $8-15B in hedge positions across Binance, OKX, Bybit via off-exchange settlement (Copper, Fireblocks).

**Rebalancing approach**:
- **Continuous, automated**: Deploys automated bots + trading team that "constantly rebalance the entire multi-venue book"
- **Event-driven**: Rebalances trigger on (a) collateral balance changes (mint/redeem), (b) funding rate moves, (c) delta drift from price changes
- **Single-leg adjustment**: Adjusts short exposure to match collateral, not the other way around. Spot/collateral is the anchor; perp shorts are the flexible leg
- **Tolerance**: Not publicly disclosed, but their risk engine detects when "hedge ratio slips" (e.g., a 5% ETH pump creating unprotected exposure) and "instantly rebalances"
- **Cost management**: Uses maker orders across multiple venues to minimize taker fees; routes based on "fees, depth of liquidity, existing positions, and other funding + basis opportunities"

**Key insight for us**: Ethena treats the spot leg as immovable and only adjusts the short leg. They never sell spot to rebalance — they resize the short.

---

## 2. Professional Basis Trading Desks (Alameda, Jump, Wintermute-era)

**Rebalancing approach**:
- **Threshold-based**: Rebalance when delta drifts beyond a set band, not on a fixed schedule
- **Common thresholds**: Professional desks typically use +-1% to +-5% net delta exposure as trigger bands, depending on position size and volatility regime
- **Incremental adjustment**: Adjust the perp leg incrementally rather than full close/reopen. This minimizes crossing the spread twice
- **Cost-aware**: Every rebalance incurs taker/maker fees + slippage. The rule of thumb: rebalancing cost must be < expected funding income during the period the position would be unhedged
- **Frequency**: Depends on volatility. In calm markets: daily check is sufficient. In volatile markets: hourly or even per-funding-interval

**Key insight for us**: The pro approach is "adjust the short to match the current spot value, not the original entry size." If you held 1000 SUI at $3.00 ($3000) and SUI is now $3.50, your new short should be 857 SUI ($3000 notional), not 1000 SUI.

---

## 3. Rage Trade (GLP Delta-Neutral Vaults)

**Architecture**: Risk-On vault holds GLP + shorts ETH/BTC via Aave flashloans. Risk-Off vault supplies USDC.

**Rebalancing approach**:
- **Event-driven with periodic check**: Updates short positions on every rebalance cycle
- **Mechanism**: Uses flashloans (Balancer) to atomically rebalance — borrow BTC/ETH, sell to USDC, deposit to Aave, borrow back to repay. Single transaction
- **Both legs adjusted**: Because GLP composition shifts, they rebalance both the hedge ratios AND the borrow positions
- **No public threshold**: Rebalancing appeared to be periodic rather than strictly threshold-based

**Key insight**: Atomic rebalancing (all in one tx) eliminates the window of naked exposure during rebalancing.

---

## 4. Neutra Finance (nGLP Delta-Neutral Vault)

**Most detailed public rebalancing parameters found in research.**

**Rebalancing approach**:
- **Tolerance Band + Volatility model**: Triggers when `asset_weight_deviation + predicted_price_volatility > m_threshold`
- **Uses ATR (Average True Range)**: Incorporates recent price volatility into the rebalancing decision — more volatile = tighter rebalancing
- **Preemptive**: Can trigger rebalancing BEFORE delta drifts too far, based on volatility prediction
- **Single-leg (perp side)**: Adjusts short positions to match GLP exposure changes

**Key insight**: The volatility-aware trigger is smart — in calm markets you tolerate more drift (saves fees), in volatile markets you rebalance tighter (saves delta exposure).

---

## 5. Hedgy / NX Finance / Vectis (JLP Delta-Neutral Vaults on Solana)

**Rebalancing approach**:
- **+-1% deviation threshold per asset**: When the short position deviates by +-1% from the calculated delta exposure, rebalancing triggers
- **Real-time monitoring**: Continuous monitoring of JLP pool composition
- **Single-leg**: Adjust perp shorts to match JLP exposure
- **Automated**: Fully automated keeper systems

**Key insight**: The +-1% threshold is the tightest we found in production. This makes sense for JLP vaults with higher yields (40-60% APY) where rebalancing costs are a smaller fraction of income.

---

## 6. Hyperliquid Ecosystem (Harmonix, Liminal, HL-Delta)

**Rebalancing approach**:
- **HL-Delta bot (open source)**: Uses **5% rebalance threshold**, checks every 60 seconds, monitors funding at minute 50 of each hour
- **Full close/reopen**: Rather than incremental adjustment, closes old position and opens new when yield drops below 5% or better opportunity exists
- **70/30 spot-to-perp capital split**: Maintains capital buffer
- **Harmonix**: Automated rebalancing of spot+perp, but parameters not public
- **Neutral Trade**: Fully automated, handles margins and rebalancing, 10% performance fee on net funding

**Key insight**: The 5% threshold + full close/reopen approach is the simplest to implement but costs more in fees. Suitable for smaller positions where code simplicity > fee optimization.

---

## 7. Umami Finance (GLP Delta-Neutral)

**Rebalancing approach**:
- **Fixed 9-hour interval**: Rebalances hedge every 9 hours regardless of drift
- **Internal netting**: Reallocates delta among multiple vaults to minimize hedging costs before going to market
- **Mean max delta exposure**: ~-1.29% in backtesting (very tight)

**Key insight**: The 9-hour fixed interval is unusually specific. Likely optimized via backtesting to balance cost vs. drift for GLP's specific volatility profile.

---

## Synthesis: Patterns Across All Protocols

| Protocol | Trigger Type | Threshold | Which Leg | Method |
|---|---|---|---|---|
| Ethena | Event + continuous | Undisclosed (tight) | Short only | Incremental adjust |
| Pro desks | Threshold-based | +-1% to +-5% | Short only | Incremental adjust |
| Rage Trade | Periodic | N/A | Both (atomic) | Full rebalance |
| Neutra Finance | Threshold + volatility | Dynamic (ATR-based) | Short only | Incremental adjust |
| Hedgy/NX/Vectis | Threshold | +-1% | Short only | Incremental adjust |
| HL-Delta | Threshold | +-5% | Both | Full close/reopen |
| Umami | Time-based | Every 9h | Short only | Incremental adjust |

**Universal patterns**:
1. **Adjust the short, not the spot** — Nearly every protocol treats spot as the anchor and resizes the perp short to match current spot value
2. **Threshold-based > time-based** — Most use deviation triggers, not fixed schedules
3. **+-1% to +-5% band** — The industry standard range. Tighter for high-yield strategies, looser for lower-yield
4. **Incremental > full close/reopen** — Saves on double-crossing the spread

---

## Practical Recommendation for Our Strategy

### Context
- Portfolio: ~$3,000 ($2,727 spot SUI + $273 Bluefin margin at 10x)
- FR yield: ~9.3% annualized = ~$0.69/day on $2,727 notional
- Bluefin taker fee: 0.1% = $2.73 per full close/reopen on $2,727 notional
- Bluefin maker fee: 0.005% = $0.14 per full rebalance with limit orders
- Auto-close trigger: FR deterioration closes short, spot remains

### The Problem Scenario

```
T0: Open position
  Spot: 1000 SUI @ $2.727 = $2,727
  Short: 1000 SUI notional = $2,727

T1: FR deteriorates, short auto-closed. SUI now $3.00
  Spot: 1000 SUI @ $3.00 = $3,000  (naked long, +$273 unrealized)
  Short: 0

T2: FR recovers, want to re-enter
  Spot: still 1000 SUI @ $3.00 = $3,000
  New short should be: $3,000 notional = 1000 SUI (matches!)
  BUT: margin requirement changed: need $300 (10x) vs original $273
```

**Key realization**: If you hold the same NUMBER of SUI tokens, the notional value of spot and short naturally match at any price. The mismatch only occurs if you:
- (a) Sold some SUI during the naked period, or
- (b) Need more margin (price went up) and don't have it, or
- (c) Have excess margin (price went down) that could be deployed

### Recommended Approach: "Anchor-on-Spot, Resize-Short"

**Method**: Keep spot SUI untouched. On re-entry, open short for exactly the current spot notional value.

**Parameters**:

| Parameter | Value | Rationale |
|---|---|---|
| **Delta tolerance band** | +-3% (~$82 on $2,727) | Wider than JLP vaults (we earn less yield so fees matter more) |
| **Rebalancing trigger** | Threshold-based, check at each funding interval (1h) | Aligns with Bluefin funding cadence |
| **Rebalance method** | Single-leg: adjust short size only | Industry standard; spot is illiquid (LST unstake delay) |
| **Order type** | Maker (limit) orders, 0.005% fee | At $2,727 notional = $0.14 per rebalance vs $2.73 taker |
| **Full close/reopen vs incremental** | Incremental (increase/decrease short) | Saves crossing spread twice |
| **Margin buffer** | Keep 15-20% excess margin | Covers price appreciation without needing to add margin |

### Implementation: Simple Decision Tree

```
Every funding interval (1h):
  1. Calculate delta = spot_notional - abs(short_notional)
  2. Calculate delta_pct = delta / spot_notional

  if abs(delta_pct) > 3%:
    if delta > 0:  // underhedged (spot > short)
      → increase short by delta amount (maker order)
    if delta < 0:  // overhedged (short > spot)
      → decrease short by abs(delta) (reduce-only maker order)

  3. Check margin health:
    if margin_ratio < 12%:
      → top up margin from reserves
    if margin_ratio > 25%:
      → withdraw excess margin to reserves
```

### Re-Entry After Full Close Procedure

```
When FR recovers and auto-close was triggered:
  1. Read current spot SUI balance and price
  2. Calculate target_short_notional = sui_balance * current_price
  3. Calculate required_margin = target_short_notional / leverage
  4. Ensure margin account has required_margin
     - If price went UP: need more margin → transfer from reserves
     - If price went DOWN: need less margin → excess stays as buffer
  5. Open new short at target_short_notional via maker order
  6. Verify delta_pct < 3%
```

### Cost Analysis

| Scenario | Cost | Recovery Time |
|---|---|---|
| Full close + reopen (taker) | $5.46 (0.2% round-trip) | ~8 days of FR income |
| Full close + reopen (maker) | $0.28 (0.01% round-trip) | ~0.4 days of FR income |
| Incremental rebalance at 3% (maker) | ~$0.004 | Negligible |
| Doing nothing (3% drift) | $0/fees but ~$82 unhedged exposure | N/A |

**Bottom line**: With maker orders, rebalancing costs are negligible. The main cost is the full close/reopen when auto-close triggers, which at maker rates recovers in under half a day.

### What We Can Skip (Simplicity)

For a $3K portfolio, we do NOT need:
- **Volatility-adaptive thresholds** (Neutra's ATR model) — overkill for our size
- **Multi-venue routing** (Ethena's approach) — we're only on Bluefin
- **Atomic flashloan rebalancing** (Rage Trade) — no composable lending on Sui for this
- **Internal netting** (Umami) — single vault, no netting possible
- **Fixed-interval rebalancing** (Umami's 9h) — threshold-based is simpler and better

### What We SHOULD Implement

1. **Hourly delta check** aligned with funding intervals (already watching FR)
2. **3% threshold trigger** for incremental short adjustment
3. **Maker-only rebalance orders** to keep costs near zero
4. **15-20% margin buffer** on initial setup to handle price appreciation
5. **Simple re-entry logic**: match short to current spot value, not historical entry

---

## Sources

- [Ethena Delta-Neutral Stability](https://docs.ethena.fi/solution-overview/usde-overview/delta-neutral-stability)
- [Ethena Hedging System](https://docs.ethena.fi/solution-design/hedging-system)
- [Ethena USDe Architecture (RocknBlock)](https://rocknblock.io/blog/stablecoin-architecture-how-ethena-usde-works)
- [Rage Trade Deep Dive (Deus Ex DAO)](https://medium.com/deus-ex-dao/deep-dive-into-rage-trades-delta-neutral-vaults-3e8f71af82c3)
- [Neutra Finance GLP Strategy](https://medium.com/@neutrafinance/delta-neutral-glp-strategy-5f86708412c0)
- [Hedgy JLP Delta Neutral Vault](https://docs.hedgy.market/vaults/jlp-delta-neutral-vault)
- [NX Finance JLP Delta Neutral Vault](https://nx-finance.gitbook.io/nx-finance-whitepaper/protocol-mechanism/strategy-3-delta-neutral-vault/jlp-delta-neutral-vault/jlp-delta-neutral-vault-faq)
- [HL-Delta (Hyperliquid open source bot)](https://github.com/cgaspart/HL-Delta)
- [Neutral Trade Hyperliquid Funding Arb](https://docs.neutral.trade/main-products/quant-strategies/market-neutral/hyperliquid-funding-arb-usdc)
- [Liminal Funding Rate Arbitrage (Nansen)](https://research.nansen.ai/articles/liminal-capturing-real-yield-via-funding-rate-arbitrage)
- [Umami Finance Delta Neutral Strategy](https://frogsanon.neworder.network/articles/delta-neutral-yield-with-umami-finance)
- [Cryptowisser Delta Neutral Strategies Guide](https://www.cryptowisser.com/guides/delta-neutral-strategies/)
- [Flipster: Build Delta-Neutral Strategy](https://flipster.io/blog/how-to-build-a-delta-neutral-strategy-using-crypto-perps-and-spot)
- [Hummingbot: Funding Rate Arbitrage on Hyperliquid](https://hummingbot.org/blog/funding-rate-arbitrage-and-creating-vaults-on-hyperliquid/)
- [Drift Vaults Introduction](https://www.drift.trade/updates/introducing-drift-vaults-the-platform-for-structured-products-on-solana)
