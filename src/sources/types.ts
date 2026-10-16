import type { Condition, Finish, SourceId } from '../core/types';

/** How a Source answered during a run (see CONTEXT.md, Source Status). */
export type SourceStatus = 'ok' | 'blocked' | 'slowed' | 'down' | 'changed';

export class SourceError extends Error {
  constructor(readonly status: Exclude<SourceStatus, 'ok'>, message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

/** A Listing as a Source reports it, before it is matched to a card in the catalogue. */
export interface SourceListing {
  id: string;
  source: SourceId;
  storeKey: string;
  storeName: string;
  city?: string;
  pickupOffered?: boolean;
  /** Title as shown on the Source, e.g. "Lightning Bolt (Showcase) (Foil) (SP)". */
  title: string;
  scryfallId?: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  finish: Finish;
  treatments: string[];
  condition: Condition | null;
  english: boolean;
  price: number;
  quantity: number;
  url: string;
  buyable: boolean;
  extra?: Record<string, string>;
}

export interface Source {
  readonly id: SourceId;
  readonly name: string;
  /** All NZ Listings the Source has for a card name. Throws SourceError when the Source misbehaves. */
  search(cardName: string, signal?: AbortSignal): Promise<SourceListing[]>;
  /** Releases resources such as a browser. */
  close?(): Promise<void>;
}
