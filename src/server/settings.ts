// The buyer's settings, kept as JSON in the user's data directory and editable in the Settings drawer.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Condition, SourceId } from '../core/types';

export interface SourceHealth {
  /** When the Source last blocked MagicFinder (ISO time). */
  blockedAt: string | null;
  /** Consecutive runs in which the Source blocked MagicFinder. */
  consecutiveBlockedRuns: number;
}

export interface Settings {
  postageType: 'tracked' | 'standard';
  pickupCity: string;
  ruralAddress: boolean;
  /** Store ids the buyer picks up from; remembered between runs. */
  pickupStores: string[];
  /** Per-Store postage overrides in NZD, by Store id. */
  postageOverrides: Record<string, number>;
  defaultPostage: { tracked: number; rural: number };
  minCondition: Condition;
  allowFoils: boolean;
  useListPrintings: boolean;
  includeBasics: boolean;
  sources: Record<SourceId, boolean>;
  theme: 'dark' | 'light';
  /** Everyday cards used to tell a silent block from real Not Founds. Edit here to change the basket. */
  staples: string[];
  /** Seconds per exact rung of the Ladder. */
  rungTimeLimitS: number;
  sourceHealth: Record<SourceId, SourceHealth>;
  /** The "new version available" check: when it last ran, what it found, and a version the buyer dismissed. */
  updateCheck: { lastCheckedAt: string | null; latest: { version: string; url: string } | null; dismissed: string | null };
  cardKingdom: { enabled: boolean; shippingUsd: number; addGst: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  postageType: 'tracked',
  pickupCity: 'Auckland',
  ruralAddress: false,
  pickupStores: [],
  postageOverrides: {},
  defaultPostage: { tracked: 7, rural: 5 },
  minCondition: 'LP',
  allowFoils: true,
  useListPrintings: false,
  includeBasics: false,
  sources: { fetch: true, mtgsingles: true },
  theme: 'dark',
  staples: ['Lightning Bolt', 'Counterspell', 'Swords to Plowshares', 'Llanowar Elves', 'Sol Ring'],
  rungTimeLimitS: 10,
  sourceHealth: {
    fetch: { blockedAt: null, consecutiveBlockedRuns: 0 },
    mtgsingles: { blockedAt: null, consecutiveBlockedRuns: 0 },
  },
  updateCheck: { lastCheckedAt: null, latest: null, dismissed: null },
  cardKingdom: { enabled: false, shippingUsd: 20, addGst: true },
};

export class SettingsStore {
  private current: Settings;
  readonly path: string;

  constructor(dataDir: string) {
    this.path = join(dataDir, 'settings.json');
    this.current = structuredClone(DEFAULT_SETTINGS);
    if (existsSync(this.path)) {
      try {
        const saved = JSON.parse(readFileSync(this.path, 'utf8'));
        this.current = merge(this.current, saved);
      } catch (e) {
        console.error(`Couldn't read ${this.path}; using defaults:`, (e as Error).message);
      }
    }
  }

  get(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings>): Settings {
    this.current = merge(this.current, patch);
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.current, null, 2));
    renameSync(tmp, this.path);
    return this.current;
  }
}

/** Deep-merges plain objects; arrays and scalars from `patch` replace. Unknown keys are dropped. */
function merge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch) || base === null || typeof base !== 'object' || Array.isArray(base)) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch as object)) {
    if (!(k in (base as object))) continue;
    const b = (base as any)[k];
    out[k] = b !== null && typeof b === 'object' && !Array.isArray(b) && k !== 'postageOverrides' ? merge(b, v) : v;
  }
  return out;
}
