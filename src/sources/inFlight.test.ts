import { describe, expect, it } from 'vitest';
import { mergeInFlight } from './inFlight';
import type { Source, SourceListing } from './types';

function slowSource() {
  const calls: { q: string; signal?: AbortSignal; answer: (l: SourceListing[]) => void }[] = [];
  const source: Source = {
    id: 'mtgsingles',
    name: 'MtgSingles',
    search: (q, signal) => new Promise((resolve, reject) => {
      calls.push({ q, signal, answer: resolve });
      signal?.addEventListener('abort', () => reject(signal.reason));
    }),
  };
  return { source, calls };
}

const listing = { id: 'x' } as SourceListing;

describe('mergeInFlight', () => {
  it('shares an identical search that is already on its way', async () => {
    const { source, calls } = slowSource();
    const merged = mergeInFlight(source);
    const a = merged.search('Sol Ring');
    const b = merged.search('Sol Ring');
    const c = merged.search('Counterspell');
    expect(calls.map(x => x.q)).toEqual(['Sol Ring', 'Counterspell']);
    calls[0].answer([listing]);
    expect(await a).toEqual([listing]);
    expect(await b).toEqual([listing]);
    // Once answered, a new search asks again (the cache decides whether it needs to).
    void merged.search('Sol Ring');
    expect(calls.map(x => x.q)).toEqual(['Sol Ring', 'Counterspell', 'Sol Ring']);
    calls[1].answer([]);
    await c;
  });

  it('keeps the request going while anyone still waits for it', async () => {
    const { source, calls } = slowSource();
    const merged = mergeInFlight(source);
    const stopA = new AbortController();
    const stopB = new AbortController();
    const a = merged.search('Sol Ring', stopA.signal);
    const b = merged.search('Sol Ring', stopB.signal);
    stopA.abort(new Error('run A stopped'));
    await expect(a).rejects.toThrow('run A stopped');
    expect(calls[0].signal!.aborted).toBe(false);
    stopB.abort(new Error('run B stopped'));
    await expect(b).rejects.toThrow('run B stopped');
    expect(calls[0].signal!.aborted).toBe(true);
  });

  it('passes errors to everyone waiting', async () => {
    const source: Source = { id: 'fetch', name: 'Fetch TCG', search: async () => { throw new Error('blocked'); } };
    const merged = mergeInFlight(source);
    await Promise.all([expect(merged.search('x')).rejects.toThrow('blocked'), expect(merged.search('x')).rejects.toThrow('blocked')]);
  });
});
