// Downloads Scryfall's default_cards bulk file (gzipped JSONL) and streams card objects out of it.
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { USER_AGENT } from '../server/paths';

export interface BulkInfo {
  updatedAt: string;
  url: string;
  size: number;
}

const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

export async function latestDefaultCards(): Promise<BulkInfo> {
  const res = await fetch('https://api.scryfall.com/bulk-data/default_cards', { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall bulk-data returned ${res.status}`);
  const body: any = await res.json();
  return { updatedAt: body.updated_at, url: body.jsonl_download_uri, size: body.compressed_size };
}

export async function* streamCards(url: string, onBytes?: (n: number) => void): AsyncGenerator<any> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Scryfall download returned ${res.status}`);
  const raw = Readable.fromWeb(res.body as any);
  if (onBytes) raw.on('data', (chunk: Buffer) => onBytes(chunk.length));
  const lines = createInterface({ input: raw.pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    const t = line.trim();
    if (t) yield JSON.parse(t);
  }
}
