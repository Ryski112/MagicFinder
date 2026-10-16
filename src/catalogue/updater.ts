// Keeps the local catalogue at most a day old.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalogue, Catalogue } from './catalogue';
import { latestDefaultCards, streamCards } from './scryfallBulk';

const DAY = 24 * 60 * 60 * 1000;

export class CatalogueStore {
  private current: Catalogue | null = null;
  private updating: Promise<void> | null = null;
  readonly path: string;
  /** 0..1 while the first download is running; for the UI. */
  progress = 0;
  error: string | null = null;

  constructor(dataDir: string) {
    this.path = join(dataDir, 'catalogue.sqlite');
    if (existsSync(this.path)) this.current = new Catalogue(this.path);
  }

  get ready(): boolean {
    return this.current !== null;
  }

  get(): Catalogue {
    if (!this.current) throw new Error('Card catalogue not downloaded yet');
    return this.current;
  }

  /** Starts a refresh if the catalogue is missing or more than a day old. Safe to call often. */
  refreshIfStale(): Promise<void> {
    const builtAt = this.current?.meta('built_at');
    if (builtAt && Date.now() - Date.parse(builtAt) < DAY) return Promise.resolve();
    this.updating ??= this.refresh().finally(() => (this.updating = null));
    return this.updating;
  }

  private async refresh() {
    try {
      const info = await latestDefaultCards();
      if (this.current?.meta('source_updated_at') === info.updatedAt) return;
      let bytes = 0;
      const count = await buildCatalogue(this.path + '.next', streamCards(info.url, n => {
        bytes += n;
        this.progress = Math.min(1, bytes / info.size);
      }), info.updatedAt);
      this.current?.close();
      const { renameSync } = await import('node:fs');
      renameSync(this.path + '.next', this.path);
      this.current = new Catalogue(this.path);
      this.error = null;
      console.log(`Card catalogue updated: ${count} printings (Scryfall ${info.updatedAt})`);
    } catch (e) {
      this.error = (e as Error).message;
      console.error('Card catalogue update failed:', this.error);
    }
  }
}
