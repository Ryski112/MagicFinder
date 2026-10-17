export function applyPin<T extends { quantity: number }>(eligible: T[], pinnedStoreId: string | undefined, storeOf: (l: T) => string, wanted: number): T[] {
  if (!pinnedStoreId) return eligible;
  const there = eligible.filter(l => storeOf(l) === pinnedStoreId);
  return there.reduce((n, l) => n + l.quantity, 0) >= wanted ? there : eligible;
}
