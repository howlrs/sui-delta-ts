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
  const marginStopPct = -Math.min(0.25, Math.max(0.10, 0.15 * sigmaR));
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
