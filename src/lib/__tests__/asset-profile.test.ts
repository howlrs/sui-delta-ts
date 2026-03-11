import { describe, it, expect } from "vitest";
import { deriveProfile } from "../asset-profile.js";

describe("deriveProfile", () => {
  const SUI = { symbol: "SUI-PERP", mmr: 0.025, maxLeverage: 20, makerFee: 0.0001, takerFee: 0.00035, hourlyVolatility: 0.007 };
  const BTC = { ...SUI, symbol: "BTC-PERP", mmr: 0.0175, hourlyVolatility: 0.0035 };
  const HIGH_VOL = { ...SUI, symbol: "ALT-PERP", hourlyVolatility: 0.012 };

  // SUI tests
  it("SUI leverage = 7", () => expect(deriveProfile(SUI).leverage).toBe(7));
  it("SUI negFrHoursExit = 18", () => expect(deriveProfile(SUI).negFrHoursExit).toBe(18));
  it("SUI marginStopPct ≈ -0.15", () => expect(deriveProfile(SUI).marginStopPct).toBeCloseTo(-0.15, 2));
  it("SUI circuitBreakerPct ≈ 0.021", () => expect(deriveProfile(SUI).circuitBreakerPct).toBeCloseTo(0.021, 3));
  it("SUI reentryPositiveHours = 6", () => expect(deriveProfile(SUI).reentryPositiveHours).toBe(6));
  it("SUI reentryWaitHours = 12", () => expect(deriveProfile(SUI).reentryWaitHours).toBe(12));

  // BTC tests
  it("BTC leverage = 14", () => expect(deriveProfile(BTC).leverage).toBe(14));
  it("BTC negFrHoursExit = 36", () => expect(deriveProfile(BTC).negFrHoursExit).toBe(36));
  it("BTC marginStopPct ≈ -0.10", () => expect(deriveProfile(BTC).marginStopPct).toBeCloseTo(-0.10, 2));
  it("BTC reentryPositiveHours = 4", () => expect(deriveProfile(BTC).reentryPositiveHours).toBe(4));
  it("BTC reentryWaitHours = 24", () => expect(deriveProfile(BTC).reentryWaitHours).toBe(24));

  // High-vol tests
  it("High-vol leverage = 4", () => expect(deriveProfile(HIGH_VOL).leverage).toBe(4));
  it("High-vol negFrHoursExit = 10", () => expect(deriveProfile(HIGH_VOL).negFrHoursExit).toBe(10));
  it("High-vol marginStopPct ≈ -0.25", () => expect(deriveProfile(HIGH_VOL).marginStopPct).toBeCloseTo(-0.25, 2));
  it("High-vol reentryPositiveHours = 10", () => expect(deriveProfile(HIGH_VOL).reentryPositiveHours).toBe(10));
  it("High-vol reentryWaitHours = 7", () => expect(deriveProfile(HIGH_VOL).reentryWaitHours).toBe(7));

  // Edge cases
  it("clamps leverage to maxLeverage", () => {
    const p = deriveProfile({ ...SUI, hourlyVolatility: 0.001, maxLeverage: 10 });
    expect(p.leverage).toBeLessThanOrEqual(10);
  });
});
