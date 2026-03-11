const SIGMA_H_SUI = 0.007;

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
    Math.max(2, Math.floor(1 / (3 * sigmaD + input.mmr))),
  );
  const marginBufferPct = Math.min(0.4, Math.max(0.15, 3 * sigmaH * leverage));
  const negFrHoursExit = Math.min(36, Math.max(6, Math.floor(18 / sigmaR)));
  const cumulativeFrFloor7d = Math.max(-0.02, Math.min(-0.002, -0.005 * sigmaR));
  const reentryPositiveHours = Math.min(12, Math.max(4, Math.floor(6 * sigmaR)));
  const reentryWaitHours = Math.min(24, Math.max(6, Math.floor(12 / sigmaR)));
  const oiFloor = 200_000;
  const deltaTolerancePct = Math.min(0.05, Math.max(0.02, 0.03 / sigmaR));
  // Old: -min(0.25, max(0.10, 0.15*σ_r)) → SUI -15% → +2.9% price で発火 → 日次ボラ3.4%でほぼ毎日発火
  // New: -min(0.60, max(0.30, 0.50*σ_r)) → SUI -50% → +9.8% price で発火 → 月1回以下
  const marginStopPct = -Math.min(0.60, Math.max(0.30, 0.50 * sigmaR));
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
