import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from './settings';
import { availableUpdate, checkForUpdate, isNewer } from './updates';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
const freshSettings = () => {
  const d = mkdtempSync(join(tmpdir(), 'mf-upd-'));
  dirs.push(d);
  return new SettingsStore(d);
};
const NOW = Date.parse('2026-10-17T00:00:00Z');
const release = (tag: string) => async () => new Response(JSON.stringify({ tag_name: tag, html_url: `https://github.com/Ryski112/MagicFinder/releases/tag/${tag}` }), { status: 200 });

describe('isNewer', () => {
  it('compares dotted versions numerically, ignoring a leading v', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.3')).toBe(true);
    expect(isNewer('v0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.1.9', '0.2.0')).toBe(false);
    expect(isNewer('1.0', '0.9.9')).toBe(true);
  });
});

describe('checkForUpdate', () => {
  it('remembers the latest release and offers it while it is newer', async () => {
    const s = freshSettings();
    await checkForUpdate(s, { fetch: release('v0.3.0'), now: () => NOW });
    expect(availableUpdate(s, '0.2.0')).toEqual({ version: '0.3.0', url: 'https://github.com/Ryski112/MagicFinder/releases/tag/v0.3.0' });
    expect(availableUpdate(s, '0.3.0')).toBeNull();
  });

  it('checks at most once a day', async () => {
    const s = freshSettings();
    let calls = 0;
    const counting = async () => (calls++, release('v0.3.0')());
    await checkForUpdate(s, { fetch: counting, now: () => NOW });
    await checkForUpdate(s, { fetch: counting, now: () => NOW + 23 * 3600_000 });
    expect(calls).toBe(1);
    await checkForUpdate(s, { fetch: counting, now: () => NOW + 25 * 3600_000 });
    expect(calls).toBe(2);
  });

  it('stays quiet when GitHub fails or the repo is private', async () => {
    const s = freshSettings();
    await checkForUpdate(s, { fetch: async () => new Response('{"message":"Not Found"}', { status: 404 }), now: () => NOW });
    await checkForUpdate(s, { fetch: async () => { throw new Error('offline'); }, now: () => NOW + 2 * 86400_000 });
    expect(availableUpdate(s, '0.2.0')).toBeNull();
  });

  it('hides a dismissed version until a newer one comes out', async () => {
    const s = freshSettings();
    await checkForUpdate(s, { fetch: release('v0.3.0'), now: () => NOW });
    s.update({ updateCheck: { ...s.get().updateCheck, dismissed: '0.3.0' } });
    expect(availableUpdate(s, '0.2.0')).toBeNull();
    await checkForUpdate(s, { fetch: release('v0.4.0'), now: () => NOW + 2 * 86400_000 });
    expect(availableUpdate(s, '0.2.0')?.version).toBe('0.4.0');
  });
});
