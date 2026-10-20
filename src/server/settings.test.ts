import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, friendSettings } from './settings';

describe('friendSettings', () => {
  it('keeps only the buyer preferences, filling missing ones from the defaults', () => {
    const f = friendSettings({ pickupCity: 'Dunedin', ruralAddress: true, staples: ['Island'], rungTimeLimitS: 99, sourceHealth: {}, nonsense: 1 });
    expect(f.pickupCity).toBe('Dunedin');
    expect(f.ruralAddress).toBe(true);
    expect(f.postageType).toBe(DEFAULT_SETTINGS.postageType);
    for (const k of ['staples', 'rungTimeLimitS', 'sourceHealth', 'updateCheck', 'nonsense']) expect(f).not.toHaveProperty(k);
  });

  it('merges nested preferences the way settings.json is merged', () => {
    const f = friendSettings({ cardKingdom: { shippingUsd: 30 }, sources: { mtgsingles: false }, postageOverrides: { 'store-a': 4 } });
    expect(f.cardKingdom).toEqual({ ...DEFAULT_SETTINGS.cardKingdom, shippingUsd: 30 });
    expect(f.sources).toEqual({ fetch: true, mtgsingles: false });
    expect(f.postageOverrides).toEqual({ 'store-a': 4 });
  });

  it('gives a new friend the defaults, with Card Kingdom compare on', () => {
    for (const nothing of [undefined, null, 'x', []]) expect(friendSettings(nothing).cardKingdom.enabled).toBe(true);
  });
});
