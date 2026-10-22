// Shapes exchanged between the server and the UI.
import type { Condition, Finish, Section, SourceId } from '../core/types';
import type { Lock } from '../core/wantList';
import type { Settings } from '../server/settings';
import type { SourceRunStatus, UnidentifiedListing } from '../server/search';
import type { CartKind } from '../core/stores';
import type { Exclusion } from '../core/eligibility';

export type { Lock, Settings, SourceRunStatus, UnidentifiedListing, Condition, Finish, Section, SourceId, CartKind, Exclusion };

/** A Store from the built-in table, for choosing preferred Stores. */
export interface StoreChoice {
  id: string;
  name: string;
  city: string | null;
  country: 'NZ' | 'AU';
}

export interface StatusResponse {
  /** Lets a second launch recognise a running MagicFinder on a port. */
  app: 'MagicFinder';
  version: string;
  catalogue: { ready: boolean; progress: number; error: string | null };
  /** A newer MagicFinder release the buyer hasn't dismissed. */
  update: { version: string; url: string } | null;
  /** Only present (and true) in hosted mode. */
  hosted?: true;
}

/** One suggestion from the Want List's card searcher. */
export interface CardSearchResult {
  oracleId: string;
  name: string;
  /** The flavour name that matched, when it wasn't the card's own name. */
  matchedAlias: string | null;
  how: 'exact' | 'starts with' | 'word starts' | 'contains' | 'typo';
  image: string | null;
}

export interface CardSearchResponse {
  results: CardSearchResult[];
}

/** A Printing offered by the card searcher's optional Printing step (from the catalogue, not from any Source). */
export interface CataloguePrintingView {
  id: string;
  /** Upper case, as written into the Want List line. */
  setCode: string;
  setName: string;
  collectorNumber: string;
  finishes: Finish[];
  treatments: string[];
  nonTournament: string | null;
  year: string;
  image: string | null;
  imageLarge: string | null;
}

export interface CardPrintingsResponse {
  printings: CataloguePrintingView[];
}

export interface WantLineView {
  id: string;
  oracleId: string;
  name: string;
  quantity: number;
  section: Section;
  isBasic: boolean;
  hint?: { text: string; lock: Lock | null };
  includedByDefault: boolean;
  image: string | null;
}

export interface ParseResponse {
  lines: WantLineView[];
  unrecognised: string[];
}

export interface ArchidektResponse {
  deckName: string;
  text: string;
}

export interface PlanChoices {
  included: Record<string, boolean>;
  locks: Record<string, Lock | null>;
  /** Line ids whose condition, foil and Printing filters are waived. */
  relaxed?: Record<string, boolean>;
  /** Line ids a Short Plan must cover. */
  required?: Record<string, boolean>;
  /** Store ids a line's card must not come from, by line id. */
  avoid?: Record<string, string[]>;
  pins?: Record<string, string>;
}

export interface StartRunRequest {
  text: string;
  choices: PlanChoices;
  /** Hosted mode: the browser's own id (shared by its tabs), so a new search replaces only that browser's. */
  browserId?: string;
  /** Hosted mode: the settings this browser keeps (the server uses only each friend's own preferences). */
  settings?: Settings;
}

/** Hosted mode: a run the page can reconnect to after a reload. */
export interface RunStateResponse {
  runId: string;
  choices: PlanChoices;
}

export interface PrintingView {
  id: string;
  label: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  treatments: string[];
  finish: Finish;
  image: string | null;
  imageLarge: string | null;
  nonTournament: string | null;
}

export interface ItemView {
  listingId: string;
  buyKey: string;
  /** Want List line ids this item fills. */
  lineIds: string[];
  oracleId: string;
  name: string;
  qty: number;
  price: number;
  condition: Condition | null;
  finish: Finish;
  /** Null when the Listing matched the card but not the exact Printing. */
  printing: PrintingView | null;
  /** Card image to show when the Printing isn't known. */
  fallbackImage: string | null;
  title: string;
  /** The Store's own picture of this Listing. */
  storeImage: string | null;
  url: string;
  source: SourceId;
  locked: boolean;
  cardKingdomNzd: number | null;
  overCardKingdom: boolean;
  /** At least 25% under CardKingdom: a bargain. */
  underCardKingdom: boolean;
  /** Source-specific details (e.g. MtgSingles' raw condition), used by the cart pre-check. */
  extra?: Record<string, string>;
}

export interface StoreView {
  id: string;
  name: string;
  city: string | null;
  /** 'AU' for an Australian Store, whose postage to NZ may be a guess. */
  country: 'NZ' | 'AU';
  /** Null for an Australian Store nobody could check: it may not ship to NZ. */
  shipsToNz: boolean | null;
  sources: SourceId[];
  site: string | null;
  storeUrl: string | null;
  cart: CartKind;
  pickupEligible: boolean;
  /** False when the Store hasn't confirmed it offers pickup (shown as "pickup not confirmed"). */
  pickupConfirmed: boolean;
  /** On the buyer's preferred list: collected for free, and not counted toward the Store limit. */
  preferred: boolean;
  pickupOn: boolean;
  pickupFee: number;
  subtotal: number;
  postage: number;
  postageKind: 'pickup' | 'postage' | 'free';
  postageEstimated: boolean;
  freeOver: number | null;
  /** Epoch ms of the oldest cached Listing used for this Store while its Source was Blocked or Down. */
  staleSince?: number;
  total: number;
  items: ItemView[];
}

export interface RungView {
  k: number;
  total: number | null;
  cards: number | null;
  postage: number | null;
  status: 'refining' | 'optimal' | 'timed-out' | 'no-plan-in-time';
  mightSave?: number;
  saves: number | null;
  cheapestOverall: boolean;
  stores: StoreView[];
  pickupHints: { storeId: string; name: string; saves: number }[];
  /** The best Plan that uses a different set of Stores. */
  next?: RungView;
  /** The runner-up was looked for and there is none. */
  noRunnerUp?: boolean;
  /** Set on a `next` Plan. */
  runnerUp?: boolean;
  /** Short Plans: copies bought out of copies wanted, and the cards left out. */
  short?: {
    covered: number;
    wanted: number;
    /** What the Plan's Stores charge over each bought card's cheapest price anywhere. */
    premium: number;
    leftOut: LeftOutView[];
    /** What buying just the left-out cards at CardKingdom would cost; null unless the comparison is on. */
    cardKingdom: CardKingdomView | null;
  };
}

export interface LeftOutView {
  buyKey: string;
  name: string;
  missing: number;
  /** Want List line ids for this card. */
  lineIds: string[];
  /** The buyer's own filters haven't been waived for this card yet. */
  waivable: boolean;
  /** Why the card isn't in the Plan, when its Stores can be compared. */
  note?: string;
  image: string | null;
}

export interface NotFoundView {
  buyKey: string;
  lineIds: string[];
  name: string;
  /** Copies that couldn't be found. */
  missing: number;
  wanted: number;
  locked: boolean;
  /** Sources that couldn't be searched for this card. */
  notSearchedOn: string[];
  /** Sources that were searched. */
  searchedOn: string[];
  /** Listings of this card that were found but left out, counted by reason. */
  excluded: Partial<Record<Exclusion, number>>;
  /** The buyer's own filters haven't been waived for this card yet. */
  waivable: boolean;
  image: string | null;
}

export interface OfferView {
  listingId: string;
  storeId: string;
  storeName: string;
  price: number;
  qty: number;
  condition: Condition | null;
  finish: Finish;
  label: string;
  /** The Scryfall id of the Printing, or null when the Listing matched the card but not a Printing. */
  printingId: string | null;
  image: string | null;
  /** The Store's own picture of this Listing. */
  storeImage: string | null;
  url: string;
  cardKingdomNzd: number | null;
  overCardKingdom: boolean;
  /** At least 25% under CardKingdom: a bargain. */
  underCardKingdom: boolean;
}

/** A card on the Want List, as the Store browser lists it. */
export interface WantedCardView {
  buyKey: string;
  lineIds: string[];
  oracleId: string;
  name: string;
  /** Copies wanted. */
  qty: number;
  image: string | null;
  locked: boolean;
}

/** A Store that has at least one wanted card, with what ordering from it costs. */
export interface ShopView {
  id: string;
  name: string;
  city: string | null;
  country: 'NZ' | 'AU';
  shipsToNz: boolean | null;
  sources: SourceId[];
  storeUrl: string | null;
  preferred: boolean;
  postage: number;
  postageEstimated: boolean;
  freeOver: number | null;
}

export interface CardKingdomView {
  usdToNzd: number;
  items: { buyKey: string; name: string; qty: number; priceUsd: number; priceNzd: number; finish: Finish; condition: Condition; label: string; url: string }[];
  missing: { buyKey: string; name: string; missing: number }[];
  subtotalUsd: number;
  shippingUsd: number;
  totalUsd: number;
  /** NZ GST on cards and shipping; 0 when the buyer has it switched off. */
  gstNzd: number;
  totalNzd: number;
}

export interface LadderView {
  planId: number;
  rungs: RungView[];
  kmin: number | null;
  final: boolean;
  notFound: NotFoundView[];
  /** Listings found but not matched to any card, so no Plan uses them. */
  unidentified: UnidentifiedListing[];
  sources: SourceRunStatus[];
  skippedBasics: string[];
  unrecognised: string[];
  /** Cards that only one Source could be asked about. */
  partialCards: string[];
  cardKingdom: CardKingdomView | null;
  offers: Record<string, OfferView[]>;
  /** Every wanted card, and every Store with some of them, for browsing by Store. */
  cards: WantedCardView[];
  shops: ShopView[];
}

/** The cheapest way to divide the list between CardKingdom and the NZ Stores of a Plan. */
export interface SplitView {
  /** The NZ Store count (not counting preferred Stores) the split may use. */
  k: number;
  planId: number;
  status: 'optimal' | 'timed-out';
  /** The selected Plan with no CardKingdom. */
  nzOnly: number;
  /** Everything from CardKingdom (shipping and GST included); null when it lacks a card. */
  ckOnly: number | null;
  /** The two parts together. */
  split: number;
  /** How much cheaper the split is than the NZ-only Plan. */
  saves: number;
  /** Null when nothing is better bought at CardKingdom. */
  ck: {
    items: { buyKey: string; lineIds: string[]; name: string; qty: number; priceUsd: number; priceNzd: number; finish: Finish; condition: Condition; label: string; url: string }[];
    subtotalUsd: number;
    shippingUsd: number;
    shippingNzd: number;
    /** NZD with GST, before shipping. */
    cardsNzd: number;
    totalNzd: number;
  } | null;
  nz: { stores: { id: string; name: string; subtotal: number; postage: number; cards: number }[]; total: number };
}

/** The Plan's cards moved to CardKingdom dearest first, one more each step, with the total at every step. */
export interface SweepView {
  k: number;
  planId: number;
  shippingUsd: number;
  /** The cards CardKingdom can supply, dearest first. `nzd` is what the NZ Plan pays; `ckNzd` is CardKingdom with GST. */
  order: { buyKey: string; lineIds: string[]; name: string; qty: number; nzd: number; ckNzd: number; ckUsd: number }[];
  /** Step `n` moves the first `n` cards of `order` to CardKingdom. */
  points: { n: number; ckTotal: number; nzTotal: number; total: number; status: 'optimal' | 'timed-out' }[];
  /** Index into `points` of the cheapest step. */
  best: number;
}

export interface SearchProgressView {
  done: number;
  total: number;
  current: string | null;
  sources: SourceRunStatus[];
}

export type RunEvent =
  | { type: 'progress'; progress: SearchProgressView }
  | { type: 'ladder'; ladder: LadderView }
  | { type: 'error'; message: string }
  /** Hosted mode: waiting for a free slot behind this many searches. */
  | { type: 'queued'; ahead: number }
  /** Hosted mode: another tab of the same browser started a newer search. */
  | { type: 'replaced' };

export interface PrintingOption {
  printing: PrintingView;
  cheapest: number | null;
  stores: number;
  /** Every in-stock Listing of this Printing, cheapest first. */
  offers: { storeId: string; storeName: string; price: number; qty: number; condition: Condition | null; url: string }[];
  locked: boolean;
  /** On the buyer's never-buy list. */
  blocked: boolean;
}

/** A Listing of the card that the title and picture couldn't tie to one Printing. */
export interface UnconfirmedListingView {
  listingId: string;
  /** On the buyer's never-buy list of Listings. */
  blocked: boolean;
  storeId: string;
  storeName: string;
  title: string;
  price: number;
  qty: number;
  condition: Condition | null;
  finish: Finish;
  /** The Store's picture. */
  image: string | null;
  url: string;
}

export interface PrintingsResponse {
  lineId: string;
  name: string;
  hint?: { text: string; lock: Lock | null };
  options: PrintingOption[];
  /** In-stock Listings whose Printing isn't known, which can't be chosen but can be judged by their picture. */
  unconfirmed: UnconfirmedListingView[];
}

export interface CartLineCheck {
  listingId: string;
  name: string;
  qty: number;
  expectedPrice: number;
  status: 'ok' | 'price-changed' | 'unavailable' | 'unconfirmed';
  currentPrice?: number;
  variantId?: string;
  url: string;
}

export interface CartCheckResponse {
  storeId: string;
  storeName: string;
  /** Null when no line could be confirmed; the UI then offers Open Listings. */
  cartUrl: string | null;
  lines: CartLineCheck[];
  /** Why the whole Store fell back (e.g. password-protected storefront). */
  fallbackReason?: string;
}

/** Lines streamed (as JSON, one per line) while the cart pre-check runs. */
export type CartCheckEvent =
  | { type: 'progress'; done: number; total: number; name: string }
  | { type: 'result'; result: CartCheckResponse }
  | { type: 'error'; message: string };
