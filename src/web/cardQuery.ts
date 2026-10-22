// The card searcher's query box doubles as its quantity: "4 bolt" or "4x bolt" means four copies of what "bolt" finds.

export const MAX_QUANTITY = 99;

/** A leading quantity typed before a card name, or null when the query starts with the name itself. */
export function leadingQuantity(q: string): { quantity: number; rest: string } | null {
  // One or two digits, so a name like "1996 World Champion" is never read as a quantity.
  const m = q.match(/^\s*(\d{1,2})\s*x?\s+(.*)$/is);
  if (!m) return null;
  return { quantity: clampQuantity(Number(m[1])), rest: m[2] };
}

export function clampQuantity(n: number) {
  return Math.max(1, Math.min(MAX_QUANTITY, Math.round(n) || 1));
}
