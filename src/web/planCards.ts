import type { ItemView, LeftOutView, NotFoundView, OfferView, StoreView } from '../shared/api';

export interface PlanCard {
  buyKey: string;
  name: string;
  qty: number;
  image: string | null;
  bought: { store: StoreView; item: ItemView }[];
  missing: number;
  notFound: boolean;
}

export function planCards(stores: StoreView[], leftOut: LeftOutView[] = [], notFound: NotFoundView[] = []): PlanCard[] {
  const cards = new Map<string, PlanCard>();
  const entry = (buyKey: string, name: string, image: string | null) => {
    let c = cards.get(buyKey);
    if (!c) cards.set(buyKey, (c = { buyKey, name, qty: 0, image, bought: [], missing: 0, notFound: false }));
    return c;
  };
  for (const store of stores) {
    for (const item of store.items) {
      const c = entry(item.buyKey, item.name, item.printing?.image ?? item.fallbackImage);
      c.qty += item.qty;
      c.bought.push({ store, item });
    }
  }
  for (const l of leftOut) {
    const c = entry(l.buyKey, l.name, l.image);
    c.qty += l.missing;
    c.missing += l.missing;
  }
  for (const n of notFound) {
    const c = entry(n.buyKey, n.name, n.image);
    c.qty += n.missing;
    c.missing += n.missing;
    c.notFound = true;
  }
  return [...cards.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function costAtStore(offers: OfferView[], storeId: string, qty: number): number | null {
  let need = qty;
  let cost = 0;
  for (const o of offers.filter(x => x.storeId === storeId).sort((a, b) => a.price - b.price)) {
    const take = Math.min(need, o.qty);
    cost += take * o.price;
    need -= take;
  }
  return need > 0 ? null : Math.round(cost * 100) / 100;
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
