// Turns a finished search plus the buyer's choices into the optimiser's problem, and the optimiser's Ladder
// into what the UI shows.
import type { Catalogue, Printing } from '../catalogue/catalogue';
import { applyPin } from '../core/pins';
import { exclusion, isEligible, passesListingFilters, WAIVABLE, type Exclusion } from '../core/eligibility';
import { pickupEligible, storeCost, type BuyerContext, type StoreDirectory, type StoreRecord } from '../core/stores';
import type { Finish, Listing } from '../core/types';
import { buyLines, isIncluded, lockFor, lockKey, type BuyLine, type ListChoices, type ResolvedWantList } from '../core/wantList';
import type { LadderState, Rung } from '../optimiser/ladder';
import { pruneDominated, type Problem } from '../optimiser/problem';
import type { ItemView, LadderView, ShopView, UnconfirmedListingView, WantedCardView, NotFoundView, OfferView, PlanChoices, PrintingOption, PrintingView, RungView, StoreView } from '../shared/api';
import { cardKingdomUnitNzd, compareAtCardKingdom, overCardKingdom, type CardKingdomContext } from './cardKingdom';
import type { SearchResult } from './search';
import type { Settings } from './settings';

export interface PlanContext {
  catalogue: Catalogue;
  directory: StoreDirectory;
  settings: Settings;
  cardKingdom: CardKingdomContext | null;
}

export interface Prepared {
  buy: BuyLine[];
  problem: Problem;
  stores: StoreRecord[];
  listings: Map<string, Listing>;
  notFound: NotFoundView[];
  buyer: BuyerContext;
  offers: Map<string, { listing: Listing; store: StoreRecord }[]>;
}

export function listChoices(choices: PlanChoices, s: Settings): ListChoices {
  return { included: choices.included, locks: choices.locks, relaxed: choices.relaxed, required: choices.required, avoid: choices.avoid, includeBasics: s.includeBasics, useListPrintings: s.useListPrintings };
}

export function buyerContext(s: Settings): BuyerContext {
  return {
    postageType: s.postageType,
    pickupCity: s.pickupCity,
    ruralAddress: s.ruralAddress,
    pickupStores: new Set(s.pickupStores),
    preferredStores: new Set(s.preferredOn ? Object.keys(s.preferredStores) : []),
    postageOverrides: s.postageOverrides,
    defaultPostage: s.defaultPostage,
    australiaPostage: s.australiaPostage,
  };
}

export function preparePlan(want: ResolvedWantList, search: SearchResult, choices: PlanChoices, ctx: PlanContext): Prepared {
  const buy = buyLines(want.lines, listChoices(choices, ctx.settings));
  const buyer = buyerContext(ctx.settings);
  const ck = ctx.cardKingdom && ctx.settings.cardKingdom.enabled && ctx.settings.cardKingdom.ignoreOver
    ? { ...ctx.cardKingdom, gst: ctx.settings.cardKingdom.addGst }
    : null;
  const settings = { minCondition: ctx.settings.minCondition, allowFoils: ctx.settings.allowFoils, blockedPrintings: ctx.settings.blockedPrintings, blockedListings: ctx.settings.blockedListings };
  const byOracle = new Map<string, Listing[]>();
  for (const l of search.listings) {
    if (!l.oracleId || ctx.settings.excludedStores[ctx.directory.forListing(l).id]) continue;
    let list = byOracle.get(l.oracleId);
    if (!list) byOracle.set(l.oracleId, (list = []));
    list.push(l);
  }

  const problem: Problem = { lines: [], stores: [], offers: [] };
  const storeIndex = new Map<string, number>();
  const stores: StoreRecord[] = [];
  const listings = new Map<string, Listing>();
  const notFound: NotFoundView[] = [];
  const offers = new Map<string, { listing: Listing; store: StoreRecord }[]>();
  const notSearched = (oracleId: string) => search.sources.filter(s => s.notSearched.includes(oracleId)).map(s => s.name);
  const searched = (oracleId: string) => search.sources.filter(s => s.status !== 'off' && !s.notSearched.includes(oracleId)).map(s => s.name);

  for (const line of buy) {
    const avoided = (l: Listing) => !!line.avoid?.includes(ctx.directory.forListing(l).id);
    const usable = (byOracle.get(line.oracleId) ?? []).filter(l => isEligible(l, line, ctx.catalogue, settings) && !avoided(l));
    const pinned = applyPin(
      usable,
      choices.pins?.[line.key],
      l => ctx.directory.forListing(l).id,
      line.quantity,
    );
    const eligible = ck ? withoutOverpriced(pinned, line, ctx.catalogue, ck) : pinned;
    const available = eligible.reduce((s, l) => s + l.quantity, 0);
    const need = Math.min(line.quantity, available);
    if (need < line.quantity) {
      const excluded: Partial<Record<Exclusion, number>> = {};
      for (const l of byOracle.get(line.oracleId) ?? []) {
        const why = exclusion(l, line, ctx.catalogue, settings) ?? (avoided(l) ? 'avoided-store' : null);
        if (why) excluded[why] = (excluded[why] ?? 0) + 1;
      }
      notFound.push({
        buyKey: line.key, lineIds: line.lineIds, name: line.name, missing: line.quantity - need, wanted: line.quantity,
        locked: !!line.lock, notSearchedOn: notSearched(line.oracleId), searchedOn: searched(line.oracleId), excluded,
        waivable: !line.relaxed,
        image: cardImage(ctx.catalogue, line.oracleId),
      });
    }
    if (!need) continue;
    const lineIdx = problem.lines.length;
    problem.lines.push({ key: line.key, need, required: line.required });
    const lineOffers: { listing: Listing; store: StoreRecord }[] = [];
    offers.set(line.key, lineOffers);
    // The Store a card is pinned to is the only one the Plan may use, but every Store's Listings stay visible.
    for (const l of ck ? withoutOverpriced(usable, line, ctx.catalogue, ck) : usable) {
      listings.set(l.id, l);
      lineOffers.push({ listing: l, store: ctx.directory.forListing(l) });
    }
    for (const l of eligible) {
      const rec = ctx.directory.forListing(l);
      let si = storeIndex.get(rec.id);
      if (si === undefined) {
        si = stores.length;
        storeIndex.set(rec.id, si);
        stores.push(rec);
        const cost = storeCost(rec, buyer);
        problem.stores.push({ id: rec.id, postage: cost.postage, freeOver: cost.freeOver, free: buyer.preferredStores.has(rec.id) });
      }
      problem.offers.push({ id: l.id, line: lineIdx, store: si, price: l.price, qty: l.quantity });
    }
  }
  return { buy, problem: pruneDominated(problem), stores, listings, notFound, buyer, offers };
}

/**
 * Drops Listings flagged as over CardKingdom's price. If the rest couldn't cover the line, the overpriced ones stay
 * (all of them when nothing else matches), so a card is never reported Not Found just because it's dear.
 */
function withoutOverpriced(listings: Listing[], line: BuyLine, catalogue: Catalogue, ck: CardKingdomContext): Listing[] {
  const fair = listings.filter(l => !overCardKingdom(l.price, cardKingdomUnitNzd(ck, catalogue, line.oracleId, l.finish)));
  return fair.reduce((s, l) => s + l.quantity, 0) >= line.quantity ? fair : listings;
}

export function printingView(p: Printing, finish: Finish): PrintingView {
  const finishLabel = finish === 'foil' ? 'Foil' : finish === 'etched' ? 'Etched foil' : '';
  return {
    id: p.id,
    label: [p.setName, `#${p.collectorNumber}`, ...p.treatments, finishLabel].filter(Boolean).join(' · '),
    setName: p.setName,
    setCode: p.setCode.toUpperCase(),
    collectorNumber: p.collectorNumber,
    treatments: p.treatments,
    finish,
    image: p.imageSmall,
    imageLarge: p.imageNormal,
    nonTournament: p.nonTournament,
  };
}

export function cardImage(catalogue: Catalogue, oracleId: string): string | null {
  return catalogue.printingsOf(oracleId).find(p => p.imageSmall && !p.nonTournament)?.imageSmall ?? null;
}

function storeUrl(rec: StoreRecord, items: Listing[]): string | null {
  if (rec.site) return rec.site;
  // A Store missing from the table (every Australian one): its Listings' own web address leads to its shop.
  const own = items.find(l => l.source === 'mtgsingles-au')?.url;
  if (own) {
    try {
      return new URL(own).origin;
    } catch {
      return null;
    }
  }
  const profile = items.find(l => l.source === 'fetch')?.extra?.profile;
  return profile ? `https://www.fetchtcg.com/profiles/${encodeURIComponent(profile)}` : null;
}

export interface ViewExtras {
  planId: number;
  want: ResolvedWantList;
  search: SearchResult;
  choices: PlanChoices;
}

export function ladderView(prep: Prepared, state: LadderState, ctx: PlanContext, x: ViewExtras): LadderView {
  const { catalogue, settings } = ctx;
  const buyByKey = new Map(prep.buy.map(b => [b.key, b]));
  const ck = ctx.cardKingdom && settings.cardKingdom.enabled ? { ...ctx.cardKingdom, gst: settings.cardKingdom.addGst } : null;
  const offers: LadderView['offers'] = {};
  for (const [key, list] of prep.offers) {
    const b = buyByKey.get(key)!;
    offers[key] = list
      .map(({ listing: l, store }): OfferView => {
        const p = l.printingId ? catalogue.getPrinting(l.printingId) : null;
        const ckNzd = ck ? cardKingdomUnitNzd(ck, catalogue, b.oracleId, l.finish) : null;
        return {
          listingId: l.id, storeId: store.id, storeName: store.name, price: l.price, qty: l.quantity, condition: l.condition, finish: l.finish,
          label: p ? printingView(p, l.finish).label : l.title, printingId: p?.id ?? null, storeImage: l.imageUrl ?? null, image: p?.imageSmall ?? cardImage(catalogue, b.oracleId), url: l.url, cardKingdomNzd: ckNzd, overCardKingdom: overCardKingdom(l.price, ckNzd),
        };
      })
      .sort((a, b) => a.price - b.price);
  }
  const staleBySource = new Map(x.search.sources.filter(s => s.staleSince).map(s => [s.source, s.staleSince!]));

  const viewRung = (r: Rung): RungView => {
    if (!r.plan) {
      return { k: r.k, total: null, cards: null, postage: null, status: r.status, saves: null, cheapestOverall: false, stores: [], pickupHints: [] };
    }
    const byStore = new Map<number, { listing: Listing; qty: number; line: number }[]>();
    for (const [i, qty] of r.plan.take) {
      const o = prep.problem.offers[i];
      let list = byStore.get(o.store);
      if (!list) byStore.set(o.store, (list = []));
      list.push({ listing: prep.listings.get(o.id)!, qty, line: o.line });
    }
    const stores: StoreView[] = r.plan.stores.map((ps): StoreView => {
      const rec = prep.stores[ps.store];
      const cost = storeCost(rec, prep.buyer);
      const entries = byStore.get(ps.store) ?? [];
      const sources = [...new Set(entries.map(e => e.listing.source))];
      const staleSince = sources.map(s => staleBySource.get(s)).filter((v): v is number => !!v).sort()[0];
      const items: ItemView[] = entries.map(({ listing: l, qty, line }) => {
        const b = buyByKey.get(prep.problem.lines[line].key)!;
        const p = l.printingId ? catalogue.getPrinting(l.printingId) : null;
        const ckNzd = ck ? cardKingdomUnitNzd(ck, catalogue, b.oracleId, l.finish) : null;
        return {
          listingId: l.id, buyKey: b.key, lineIds: b.lineIds, oracleId: b.oracleId, name: b.name, qty, price: l.price,
          condition: l.condition, finish: l.finish, printing: p ? printingView(p, l.finish) : null,
          fallbackImage: p?.imageSmall ? null : cardImage(catalogue, b.oracleId), title: l.title, storeImage: l.imageUrl ?? null, url: l.url, source: l.source,
          locked: !!b.lock, cardKingdomNzd: ckNzd, overCardKingdom: overCardKingdom(l.price, ckNzd), extra: l.extra,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));
      return {
        id: rec.id, name: rec.name, city: rec.location.city, country: rec.country ?? 'NZ', sources, site: rec.site ?? null, storeUrl: storeUrl(rec, entries.map(e => e.listing)),
        cart: rec.cart, pickupEligible: pickupEligible(rec, prep.buyer), pickupConfirmed: rec.pickup.available === true,
        preferred: prep.buyer.preferredStores.has(rec.id), pickupOn: cost.kind === 'pickup' && !prep.buyer.preferredStores.has(rec.id), pickupFee: rec.pickup.fee, subtotal: ps.subtotal, postage: ps.postage,
        postageKind: cost.kind === 'pickup' ? 'pickup' : ps.postage === 0 ? 'free' : 'postage', postageEstimated: cost.estimated && cost.kind !== 'pickup',
        freeOver: cost.kind === 'pickup' ? null : cost.freeOver, staleSince, total: Math.round((ps.subtotal + ps.postage) * 100) / 100, items,
      };
    }).sort((a, b) => b.total - a.total);
    const pickupHints = stores
      .filter(s => s.pickupEligible && !s.pickupOn && s.postage > s.pickupFee)
      .map(s => ({ storeId: s.id, name: s.name, saves: Math.round((s.postage - s.pickupFee) * 100) / 100 }));
    let short: RungView['short'];
    if (r.short) {
      const bought = new Map<number, number>();
      for (const [i, q] of r.plan.take) bought.set(prep.problem.offers[i].line, (bought.get(prep.problem.offers[i].line) ?? 0) + q);
      const leftOut = prep.problem.lines.flatMap((l, line) => {
        const missing = l.need - (bought.get(line) ?? 0);
        const b = buyByKey.get(l.key)!;
        if (missing <= 0) return [];
        // Why it's out: what the Stores of this Plan (and preferred Stores) have, against the cheapest anywhere.
        const mine = new Set([...(r.plan?.stores ?? []).map(ps => ps.store), ...prep.stores.flatMap((rec, i) => (prep.buyer.preferredStores.has(rec.id) ? [i] : []))]);
        const offers = prep.problem.offers.filter(o => o.line === line).sort((x, y) => x.price - y.price);
        const here = offers.find(o => mine.has(o.store));
        const best = offers[0];
        const note = !best ? undefined
          : !here ? `Not in stock at these Stores. Cheapest: ${prep.stores[best.store].name}, $${best.price.toFixed(2)}`
          : `In stock at ${prep.stores[here.store].name} for $${here.price.toFixed(2)}, but including it would leave out other cards`;
        return [{ buyKey: l.key, name: b.name, missing, lineIds: b.lineIds, waivable: !b.required, note, image: cardImage(catalogue, b.oracleId) }];
      });
      const leftOutBuy = leftOut.map(l => ({ ...buyByKey.get(l.buyKey)!, quantity: l.missing }));
      const leftOutCk = ck && leftOutBuy.length
        ? compareAtCardKingdom(leftOutBuy, catalogue, ck, { allowFoils: settings.allowFoils, shippingUsd: settings.cardKingdom.shippingUsd })
        : null;
      short = { covered: r.short.covered, wanted: r.short.wanted, leftOut, cardKingdom: leftOutCk };
    }
    return {
      k: r.k, total: r.plan.total, cards: r.plan.cards, postage: r.plan.postage, status: r.status, mightSave: r.mightSave,
      saves: r.saves, cheapestOverall: r.cheapestOverall, stores, pickupHints, short,
    };
  };
  const rungs: RungView[] = state.rungs.map(r => {
    const view = viewRung(r);
    return r.next ? { ...view, next: { ...viewRung(r.next), runnerUp: true } } : r.noRunnerUp ? { ...view, noRunnerUp: true } : view;
  });

  const cards: WantedCardView[] = prep.buy.map(b => ({
    buyKey: b.key, lineIds: b.lineIds, oracleId: b.oracleId, name: b.name, qty: b.quantity, image: cardImage(catalogue, b.oracleId), locked: !!b.lock,
  }));
  const shopListings = new Map<string, Listing[]>();
  for (const list of prep.offers.values()) for (const { listing, store } of list) {
    let g = shopListings.get(store.id);
    if (!g) shopListings.set(store.id, (g = []));
    g.push(listing);
  }
  const shops: ShopView[] = prep.stores.filter(rec => shopListings.has(rec.id)).map(rec => {
    const cost = storeCost(rec, prep.buyer);
    const sources = [...new Set(shopListings.get(rec.id)!.map(l => l.source))];
    return {
      id: rec.id, name: rec.name, city: rec.location.city, country: rec.country ?? 'NZ', sources, storeUrl: storeUrl(rec, shopListings.get(rec.id)!),
      preferred: prep.buyer.preferredStores.has(rec.id), postage: cost.postage, postageEstimated: cost.estimated && cost.kind !== 'pickup', freeOver: cost.kind === 'pickup' ? null : cost.freeOver,
    };
  });

  const lc = listChoices(x.choices, settings);
  const skippedBasics = x.want.lines.filter(l => l.isBasic && !settings.includeBasics && isIncluded({ ...l, isBasic: false }, lc)).map(l => `${l.quantity} ${l.name}`);
  const partial = new Set(x.search.sources.flatMap(s => s.notSearched));
  const partialCards = prep.buy.filter(b => partial.has(b.oracleId)).map(b => b.name);
  return {
    planId: x.planId, rungs, kmin: state.kmin, final: state.final, notFound: prep.notFound, unidentified: x.search.unidentified,
    sources: x.search.sources, cards, shops, skippedBasics, unrecognised: x.want.unrecognised, partialCards, offers,
    cardKingdom: ck && prep.buy.length
      ? compareAtCardKingdom(prep.buy, catalogue, ck, { allowFoils: settings.allowFoils, shippingUsd: settings.cardKingdom.shippingUsd })
      : null,
  };
}

/** In-stock Listings of a line's card whose Printing the title and picture didn't settle, so they can't be locked. */
export function unconfirmedListings(want: ResolvedWantList, search: SearchResult, lineId: string, ctx: PlanContext): UnconfirmedListingView[] {
  const line = want.lines.find(l => l.id === lineId);
  if (!line) return [];
  const settings = { minCondition: ctx.settings.minCondition, allowFoils: true };
  return search.listings
    .filter(l => l.oracleId === line.oracleId && l.confidence === 'card-only' && passesListingFilters(l, settings) && !ctx.settings.excludedStores[ctx.directory.forListing(l).id])
    .map(l => {
      const rec = ctx.directory.forListing(l);
      return { listingId: l.id, blocked: !!ctx.settings.blockedListings[l.id], storeId: rec.id, storeName: rec.name, title: l.title, price: l.price, qty: l.quantity, condition: l.condition, finish: l.finish, image: l.imageUrl ?? null, url: l.url };
    })
    .sort((a, b) => a.price - b.price);
}

/** Alternative Printings for one Want List line, cheapest first, with what each costs and where. */
export function printingOptions(want: ResolvedWantList, search: SearchResult, lineId: string, choices: PlanChoices, ctx: PlanContext): PrintingOption[] {
  const line = want.lines.find(l => l.id === lineId);
  if (!line) return [];
  const lock = lockFor(line, listChoices(choices, ctx.settings));
  const settings = { minCondition: ctx.settings.minCondition, allowFoils: true };
  const groups = new Map<string, { printing: Printing; finish: Finish; prices: number[]; stores: Set<string>; offers: PrintingOption['offers'] }>();
  for (const l of search.listings) {
    if (l.oracleId !== line.oracleId || l.confidence !== 'exact' || !l.printingId || !passesListingFilters(l, settings)) continue;
    if (ctx.settings.excludedStores[ctx.directory.forListing(l).id]) continue;
    const p = ctx.catalogue.getPrinting(l.printingId);
    if (!p) continue;
    const key = lockKey({ printingId: p.id, finish: l.finish });
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { printing: p, finish: l.finish, prices: [], stores: new Set(), offers: [] }));
    const rec = ctx.directory.forListing(l);
    g.prices.push(l.price);
    g.stores.add(rec.id);
    g.offers.push({ storeId: rec.id, storeName: rec.name, price: l.price, qty: l.quantity, condition: l.condition, url: l.url });
  }
  if (lock && !groups.has(lockKey(lock))) {
    const p = ctx.catalogue.getPrinting(lock.printingId);
    if (p) groups.set(lockKey(lock), { printing: p, finish: lock.finish, prices: [], stores: new Set(), offers: [] });
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      printing: printingView(g.printing, g.finish),
      cheapest: g.prices.length ? Math.min(...g.prices) : null,
      stores: g.stores.size,
      offers: g.offers.sort((a, b) => a.price - b.price),
      locked: !!lock && lockKey(lock) === key,
      blocked: !!ctx.settings.blockedPrintings[g.printing.id],
    }))
    .sort((a, b) => (a.cheapest ?? Infinity) - (b.cheapest ?? Infinity));
}

