import type { ItemView, LeftOutView, NotFoundView, OfferView, StoreView } from '../shared/api';

/** A Plan from before the server sent `waivable` can still be relaxed. */
export const isWaivable = (n: NotFoundView): boolean => n.waivable ?? true;

export interface PlanCard {
  buyKey: string;
  name: string;
  qty: number;
  image: string | null;
  /** Want List line ids this card fills (none for a card a Short Plan only leaves out). */
  lineIds: string[];
  bought: { store: StoreView; item: ItemView }[];
  missing: number;
  notFound: boolean;
  /** Not Found only because of the buyer's own filters, which they can waive for this card. */
  waivable: boolean;
}

export function planCards(stores: StoreView[], leftOut: LeftOutView[] = [], notFound: NotFoundView[] = []): PlanCard[] {
  const cards = new Map<string, PlanCard>();
  const entry = (buyKey: string, name: string, image: string | null) => {
    let c = cards.get(buyKey);
    if (!c) cards.set(buyKey, (c = { buyKey, name, qty: 0, image, lineIds: [], bought: [], missing: 0, notFound: false, waivable: false }));
    return c;
  };
  for (const store of stores) {
    for (const item of store.items) {
      const c = entry(item.buyKey, item.name, item.printing?.image ?? item.fallbackImage);
      c.qty += item.qty;
      c.bought.push({ store, item });
      c.lineIds = [...new Set([...c.lineIds, ...item.lineIds])];
    }
  }
  for (const l of leftOut) {
    const c = entry(l.buyKey, l.name, l.image);
    c.qty += l.missing;
    c.missing += l.missing;
    c.lineIds = [...new Set([...c.lineIds, ...(l.lineIds ?? [])])];
    c.waivable = l.waivable ?? true;
  }
  for (const n of notFound) {
    const c = entry(n.buyKey, n.name, n.image);
    c.qty += n.missing;
    c.missing += n.missing;
    c.notFound = true;
    c.waivable = isWaivable(n);
    c.lineIds = [...new Set([...c.lineIds, ...n.lineIds])];
  }
  return [...cards.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The cheapest Listings at a Store that make up `qty` copies, or null when it has too few. */
export function fillAtStore(offers: OfferView[], storeId: string, qty: number): { offer: OfferView; qty: number }[] | null {
  let need = qty;
  const fill: { offer: OfferView; qty: number }[] = [];
  for (const o of offers.filter(x => x.storeId === storeId).sort((a, b) => a.price - b.price)) {
    if (need <= 0) break;
    const take = Math.min(need, o.qty);
    if (take > 0) fill.push({ offer: o, qty: take });
    need -= take;
  }
  return need > 0 ? null : fill;
}

export function costAtStore(offers: OfferView[], storeId: string, qty: number): number | null {
  const fill = fillAtStore(offers, storeId, qty);
  return fill && Math.round(fill.reduce((s, f) => s + f.qty * f.offer.price, 0) * 100) / 100;
}

export function currentCost(card: PlanCard): number {
  return Math.round(card.bought.reduce((s, b) => s + b.item.price * b.item.qty, 0) * 100) / 100;
}

export interface Elsewhere {
  card: PlanCard;
  cost: number;
  current: number;
}

export function cardsElsewhere(storeId: string, cards: PlanCard[], offers: Record<string, OfferView[]>): Elsewhere[] {
  return cards.flatMap(card => {
    if (card.bought.some(b => b.store.id === storeId)) return [];
    const cost = costAtStore(offers[card.buyKey] ?? [], storeId, card.qty);
    return cost === null ? [] : [{ card, cost, current: currentCost(card) }];
  });
}

/** How many Printings a card's Listings offer, counting each finish apart. Listings that don't say which Printing they are aren't counted. */
export function printingCount(offers: OfferView[]): number {
  return new Set(offers.flatMap(o => (o.printingId ? [`${o.printingId}:${o.finish}`] : []))).size;
}
