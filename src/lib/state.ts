import { readFileSync, writeFileSync, existsSync } from "node:fs";

const STATE_FILE = process.env.STATE_FILE ?? "state.json";

export interface WatchState {
  negativeStreakHours: number;
  frHistory7d: number[];
  lastCloseTime: number | null;
  positionOpen: boolean;
  totalFrEarned: number;
  lastPrice: number | null;
}

export function defaultState(): WatchState {
  return {
    negativeStreakHours: 0,
    frHistory7d: [],
    lastCloseTime: null,
    positionOpen: false,
    totalFrEarned: 0,
    lastPrice: null,
  };
}

export function loadState(): WatchState {
  if (!existsSync(STATE_FILE)) return defaultState();
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const saved = JSON.parse(raw) as Partial<WatchState>;
    return { ...defaultState(), ...saved };
  } catch {
    return defaultState();
  }
}

export function saveState(state: WatchState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
