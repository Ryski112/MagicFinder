import { describe, expect, it } from 'vitest';
import { classify, withRetries } from './policy';
import { SourceError } from './types';

const noSleep = async () => {};

describe('classify', () => {
  it('sorts answers into Source Statuses', () => {
    expect(() => classify({ status: 200, body: '[]' })).not.toThrow();
    expect(() => classify({ status: 429, body: '', retryAfter: '7' })).toThrow(expect.objectContaining({ status: 'slowed', retryAfterMs: 7000 }));
    expect(() => classify({ status: 403, body: '' })).toThrow(expect.objectContaining({ status: 'blocked' }));
    expect(() => classify({ status: 503, body: '' })).toThrow(expect.objectContaining({ status: 'down' }));
    expect(() => classify({ status: 404, body: '' })).toThrow(expect.objectContaining({ status: 'changed' }));
  });
});

describe('withRetries', () => {
  it('never retries a block', async () => {
    let n = 0;
    await expect(withRetries(async () => { n++; throw new SourceError('blocked', 'x'); }, { sleep: noSleep })).rejects.toMatchObject({ status: 'blocked' });
    expect(n).toBe(1);
  });

  it('retries a Source that is down twice, then gives up', async () => {
    let n = 0;
    await expect(withRetries(async () => { n++; throw new SourceError('down', 'x'); }, { sleep: noSleep })).rejects.toMatchObject({ status: 'down' });
    expect(n).toBe(3);
  });

  it('waits when slowed down, and treats a third slow-down as blocked', async () => {
    const waits: number[] = [];
    let n = 0;
    await expect(withRetries(async () => { n++; throw new SourceError('slowed', 'x', 2000); }, { sleep: async ms => { waits.push(ms); } }))
      .rejects.toMatchObject({ status: 'blocked' });
    expect(n).toBe(3);
    expect(waits).toEqual([2000, 2000]);
  });

  it('recovers when a retry succeeds', async () => {
    let n = 0;
    expect(await withRetries(async () => { if (++n < 2) throw new SourceError('down', 'x'); return 'ok'; }, { sleep: noSleep })).toBe('ok');
  });

  it('treats unexpected exceptions such as network errors as down', async () => {
    let n = 0;
    await expect(withRetries(async () => { n++; throw new TypeError('fetch failed'); }, { sleep: noSleep })).rejects.toMatchObject({ status: 'down' });
    expect(n).toBe(3);
  });
});
