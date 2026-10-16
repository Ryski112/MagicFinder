// Archidekt deck URL import: the public deck API, read server-side (it only allows browser calls from its own site).
import { USER_AGENT } from './paths';

export function archidektDeckId(url: string): string | null {
  return url.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/)?.[1] ?? null;
}

/** Turns an Archidekt deck into paste text with section headers, so it goes through the same parser as a paste. */
export function deckToText(deck: any): string {
  const categories = new Map<string, { isPremier: boolean; includedInDeck: boolean }>();
  for (const c of deck.categories ?? []) categories.set(c.name, { isPremier: !!c.isPremier, includedInDeck: c.includedInDeck !== false });
  const sections: Record<string, string[]> = { Commander: [], Mainboard: [], Sideboard: [], Maybeboard: [] };
  for (const c of deck.cards ?? []) {
    const name: string | undefined = c.card?.oracleCard?.name;
    if (!name || !c.quantity) continue;
    const cats: string[] = c.categories ?? [];
    const info = cats.map(n => categories.get(n));
    const section = info.some(i => i && !i.includedInDeck) || cats.includes('Maybeboard') ? 'Maybeboard'
      : info.some(i => i?.isPremier) ? 'Commander'
      : cats.includes('Sideboard') ? 'Sideboard' : 'Mainboard';
    const set = c.card?.edition?.editioncode;
    const cn = c.card?.collectorNumber;
    const finish = c.modifier === 'Foil' ? ' *F*' : c.modifier === 'Etched' ? ' *E*' : '';
    sections[section].push(`${c.quantity}x ${name}${set ? ` (${set})${cn ? ` ${cn}` : ''}` : ''}${finish}`);
  }
  return Object.entries(sections)
    .filter(([, lines]) => lines.length)
    .map(([h, lines]) => `${h}\n${lines.sort().join('\n')}`)
    .join('\n\n');
}

export async function importArchidekt(url: string): Promise<{ deckName: string; text: string }> {
  const id = archidektDeckId(url);
  if (!id) throw new Error("That doesn't look like an Archidekt deck link (https://archidekt.com/decks/…).");
  const res = await fetch(`https://archidekt.com/api/decks/${id}/`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (res.status === 404 || res.status === 403) throw new Error('Archidekt says that deck is private or doesn\'t exist. Paste an export instead.');
  if (!res.ok) throw new Error(`Archidekt didn't answer properly (${res.status}). Paste an export instead.`);
  const deck = await res.json();
  return { deckName: deck.name ?? `Archidekt deck ${id}`, text: deckToText(deck) };
}
