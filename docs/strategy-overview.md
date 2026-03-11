# Delta Hedge Strategy: Bluefin FR Short + Spot SUI

## Overview

Bluefin SUI-PERP ショート (Funding Rate 収取) + Spot SUI (LST化) によるデルタニュートラル戦略。

## Why This Strategy

### LP 500% APY vs FR 9% — なぜ FR が勝つか

集中流動性 LP の表示 APY はコストを含まない **gross** 値:

| 項目 | LP (表示 500%) | FR (表示 9.3%) |
|---|---|---|
| Gross yield | 500% | 9.3% |
| IL (Impermanent Loss) | -200〜-500% | 0% |
| リバランスコスト | -15〜-50% | 0% |
| レンジ外機会損失 | -50〜-150% | 0% |
| **Net yield** | **-17〜+33%** | **~10.7%** |

根拠:
- 集中流動性 LP はカバードコール等価 → 上昇の40%しか捕捉できず、下落の90%を負う
  - 詳細: [research/concentrated-lp-upside-asymmetry.md](research/concentrated-lp-upside-asymmetry.md)
- 初期 audit で fee $0.072 vs swap cost $0.117 = 純マイナス
  - 詳細: [research/fee-compound-il-analysis.md](research/fee-compound-il-analysis.md)
- Uniswap V3 全体: IL $260M > fee $199M、46.5% のポジションが赤字

**LP APY は「売上」、FR は「利益」**。

### Bluefin FR 実データ (1000時間, Jan 28 - Mar 11 2026)

| 指標 | 値 |
|---|---|
| 平均 hourly rate | +0.001064% |
| 年率 (compound) | +9.77% |
| 正率割合 | 90.2% |
| 安定帯 (0.001-0.005%/h) | 81.5% |
| 最長連続マイナス | 17時間 (累計 -0.070%) |
| 最悪 7日間 | -0.279% |
| Sharpe (年率) | 15.01 |
| vs Binance | Bluefin +9.3% vs Binance -0.13% (構造的乖離) |

## Capital Allocation

### 10x Leverage の場合 ($10,000 例)

```
総資金 = Spot SUI + Bluefin Margin
$10,000 = $X + $X × 10%
$X = $9,091
```

| 配分 | 金額 | 割合 | 利率 | 年間収益 |
|---|---|---|---|---|
| Spot SUI (vSUI/haSUI) | $9,091 | 91% | 3.0% (LST) | $273 |
| Bluefin margin | $909 | 9% | 0% (遊休) | $0 |
| **Short notional (=FR対象)** | **$9,091** | **91%** | **9.3%** | **$845** |
| **合計** | $10,000 | | **11.2%** | **$1,118** |

### レバレッジ別 FR 対象率

| Leverage | Margin率 | FR対象率 | 清算まで |
|---|---|---|---|
| 26x (max) | 3.8% | 96.3% | ~2% (危険) |
| 20x | 5.0% | 95.2% | ~3% (危険) |
| **10x** | **10%** | **90.9%** | **~8% (推奨)** |
| 5x | 20% | 83.3% | ~18% (安全) |

## Bluefin SUI-PERP Specs

| 項目 | 値 |
|---|---|
| Max leverage | 20x (IMR 3.8%) |
| Maker fee | 0.005% |
| Taker fee | 0.1% |
| Funding | 1h毎、cap ±0.1%/h |
| 板の厚さ (±1%) | $700K-$900K |
| 24h volume | ~$6.4M |
| OI | ~$856K |

## SDK

- Package: `@bluefin-exchange/pro-sdk` v1.13.0
- Peer dep: `@mysten/sui` ^1.28.2 (v1.x — Cetus SDK 互換)
- Architecture: Off-chain orderbook (REST/WS) + On-chain settlement (Sui Move)
- Auth: JWT bearer token (SDK 自動管理)
- API docs: https://bluefin-exchange.readme.io/reference

## Risk Assessment

| リスク | 確率 | 影響 | 対策 |
|---|---|---|---|
| FR 体制変化 (→3-4%) | 中 | 収益半減 | watch-fr.ts で閾値監視 |
| FR 一時マイナス | 高 (月1-2回) | 軽微 | 2.4日で回復 (実データ) |
| Bluefin SC bug | 低 | 高 | 4社監査済み、position size 制限 |
| Admin key 集中 | 中 | 高 | TVL/公式チャンネル監視 |
| USDC.e depeg | 極低 | 高 | Wormhole 依存、分散不可 |
| 清算 (10x) | 低 | margin 喪失 | Spot SUI の含み益で相殺 |

## Implementation Plan

1. `check-bluefin.ts` — ポジション確認、FR・板表示 (#1)
2. `open-short.ts` — USDC deposit → SUI-PERP short (#2)
3. `watch-fr.ts` — FR 監視 → 自動決済 (#3)
4. `close-position.ts` — reduce-only close → withdraw (#4)
5. Deploy: Spot SUI LST化 + Bluefin short 建て (#5)

## Related Documents

### Strategy Motivation (HIGH relevance)
- [research/concentrated-lp-upside-asymmetry.md](research/concentrated-lp-upside-asymmetry.md) — LP の非対称損失構造
- [research/fee-compound-il-analysis.md](research/fee-compound-il-analysis.md) — IL・リバランスコスト分析
- [2026-03-03-deepbook-hedge-design.md](2026-03-03-deepbook-hedge-design.md) — DeepBook ヘッジ設計 (先行参考)

### Rebalancing Research (HIGH relevance)
- [research/rebalancing-after-hedge-reentry.md](research/rebalancing-after-hedge-reentry.md) — Delta-neutral rebalancing after hedge removal/re-entry (Ethena, Rage Trade, Neutra, Hedgy, HL-Delta, Umami)

### Context (MEDIUM relevance)
- [research/lp-strategy-analysis.md](research/lp-strategy-analysis.md) — LP 収益性分析
- [research/pool-position-analysis.md](research/pool-position-analysis.md) — プール構造分析
- [research/rebalance-pattern-analysis.md](research/rebalance-pattern-analysis.md) — リバランスコスト分析
- [price-direction.md](price-direction.md) — CLMM 価格方向ガイド
