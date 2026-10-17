// "A new version is available" notice: at most once a day, ask GitHub for the latest release and remember it in the
// settings. Silent on any failure (offline, rate-limited, or the repo still private). No self-updating.
// Decided in "Which packaging approach, and where do friends download it?".
import { USER_AGENT } from './paths';
import type { SettingsStore } from './settings';

const LATEST_RELEASE = 'https://api.github.com/repos/Ryski112/MagicFinder/releases/latest';
const DAY = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  version: string;
  /** The release page, which shows its notes and downloads. */
  url: string;
}

const parts = (v: string) => v.replace(/^v/, '').split('.').map(n => Number.parseInt(n, 10) || 0);

/** True when `latest` is a higher dotted version than `current` ("v0.10.0" > "0.9.3"). */
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** The release to offer the buyer, or null when there's nothing newer or they dismissed it. */
export function availableUpdate(settings: SettingsStore, current: string): UpdateInfo | null {
  const { latest, dismissed } = settings.get().updateCheck;
  return latest && isNewer(latest.version, current) && latest.version !== dismissed ? latest : null;
}

export async function checkForUpdate(settings: SettingsStore, opts: { fetch?: typeof fetch; now?: () => number } = {}): Promise<void> {
  const now = opts.now?.() ?? Date.now();
  const last = settings.get().updateCheck.lastCheckedAt;
  if (last && now - Date.parse(last) < DAY) return;
  try {
    const res = await (opts.fetch ?? fetch)(LATEST_RELEASE, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
    const check = { ...settings.get().updateCheck, lastCheckedAt: new Date(now).toISOString() };
    const r = res.ok ? ((await res.json()) as { tag_name?: string; html_url?: string }) : {};
    if (r.tag_name && r.html_url) check.latest = { version: r.tag_name.replace(/^v/, ''), url: r.html_url };
    settings.update({ updateCheck: check });
  } catch {
    // Offline or timed out: try again next time.
  }
}
