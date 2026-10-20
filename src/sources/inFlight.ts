// Identical searches already on their way are shared rather than sent again: two runs asking a Source about the same
// card at the same time make one request. Decided in "How far can sharing stretch the Sources' rate limits in hosted
// mode?". With one run (the desktop) a card is never asked twice at once, so nothing changes there.
import type { Source, SourceListing } from './types';

export function mergeInFlight(src: Source): Source {
  const inFlight = new Map<string, { result: Promise<SourceListing[]>; abort: AbortController; waiting: number }>();
  return {
    id: src.id,
    name: src.name,
    close: src.close?.bind(src),
    search(cardName, signal) {
      let entry = inFlight.get(cardName);
      if (!entry) {
        const abort = new AbortController();
        const created = { result: src.search(cardName, abort.signal), abort, waiting: 0 };
        created.result.then(
          () => inFlight.get(cardName) === created && inFlight.delete(cardName),
          () => inFlight.get(cardName) === created && inFlight.delete(cardName),
        );
        inFlight.set(cardName, (entry = created));
      }
      const shared = entry;
      shared.waiting++;
      return new Promise<SourceListing[]>((resolve, reject) => {
        // One run giving up doesn't stop the request for the others; the last one to give up does.
        const giveUp = () => {
          if (--shared.waiting === 0) {
            if (inFlight.get(cardName) === shared) inFlight.delete(cardName);
            shared.abort.abort(signal!.reason);
          }
          reject(signal!.reason);
        };
        if (signal?.aborted) return giveUp();
        signal?.addEventListener('abort', giveUp, { once: true });
        shared.result.then(
          v => {
            signal?.removeEventListener('abort', giveUp);
            shared.waiting--;
            resolve(v);
          },
          e => {
            signal?.removeEventListener('abort', giveUp);
            shared.waiting--;
            reject(e);
          },
        );
      });
    },
  };
}
