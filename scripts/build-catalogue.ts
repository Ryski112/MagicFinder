// Downloads Scryfall's default_cards and builds the local catalogue now. Normally the app does this itself.
import { CatalogueStore } from '../src/catalogue/updater';
import { dataDir } from '../src/server/paths';

const store = new CatalogueStore(dataDir());
const started = Date.now();
await store.refreshIfStale();
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s -> ${store.path}`);
