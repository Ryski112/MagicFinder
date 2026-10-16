/**
 * Name key used to match card names across Sources: accents stripped, lower case,
 * every split/double-faced separator and other punctuation removed, spaces squashed.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/\/+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Punctuation-preserving key, used for the few names whose nameKey collides. */
export function exactKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/\s*\/\/?\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim();
}
