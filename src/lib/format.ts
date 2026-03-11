const E9 = 1_000_000_000;

export function toE9(value: number): string {
  return String(Math.floor(value * E9));
}

export function fromE9(e9: string): number {
  return Number(e9) / E9;
}

export function fmt(value: number, decimals = 4): string {
  return value.toFixed(decimals);
}

export function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function fmtPct(value: number, decimals = 4): string {
  return `${(value * 100).toFixed(decimals)}%`;
}
