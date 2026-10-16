// Search results per (Source, card name), so re-planning never searches again and repeated runs within an hour
// are instant. Older entries (up to a day) stand in for a Source that is Blocked or Down.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { SourceListing } from '../sources/types';
import type { SourceId } from '../core/types';

export const FRESH_MS = 60 * 60 * 1000;
export const STALE_MS = 24 * 60 * 60 * 1000;

export interface CachedSearch {
  listings: SourceListing[];
  fetchedAt: number;
}

export class SearchCache {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(join(dataDir, 'search-cache.sqlite'));
    this.db.exec('CREATE TABLE IF NOT EXISTS searches (source TEXT, query TEXT, fetched_at INTEGER, body TEXT, PRIMARY KEY (source, query))');
    this.db.prepare('DELETE FROM searches WHERE fetched_at < ?').run(Date.now() - STALE_MS);
  }

  get(source: SourceId, query: string, maxAgeMs: number): CachedSearch | null {
    const row = this.db.prepare('SELECT fetched_at, body FROM searches WHERE source = ? AND query = ?').get(source, query.toLowerCase()) as
      | { fetched_at: number; body: string }
      | undefined;
    if (!row || Date.now() - row.fetched_at > maxAgeMs) return null;
    return { listings: JSON.parse(row.body), fetchedAt: row.fetched_at };
  }

  put(source: SourceId, query: string, listings: SourceListing[], fetchedAt = Date.now()) {
    this.db.prepare('INSERT OR REPLACE INTO searches VALUES (?, ?, ?, ?)').run(source, query.toLowerCase(), fetchedAt, JSON.stringify(listings));
  }
}
