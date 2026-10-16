// Shapes exchanged between the server and the UI.
import type { Condition, Finish, Section, SourceId } from '../core/types';
import type { Lock } from '../core/wantList';
import type { Settings } from '../server/settings';
import type { SourceRunStatus } from '../server/search';
import type { CartKind } from '../core/stores';

export type { Lock, Settings, SourceRunStatus, Condition, Finish, Section, SourceId, CartKind };

export interface StatusResponse {
  version: string;
  catalogue: { ready: boolean; progress: number; error: string | null };
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
}

export interface StartRunRequest {
  text: string;
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
  url: string;
  source: SourceId;
  locked: boolean;
  /** Shopify product handle and condition hints for the cart pre-check. */
  extra?: Record<string, string>;
  offerOnly?: boolean;
}

export interface StoreView {
  id: string;
  name: string;
  city: string | null;
  sources: SourceId[];
  site: string | null;
  storeUrl: string | null;
  cart: CartKind;
  pickupEligible: boolean;
  /** False when the Store hasn't confirmed it offers pickup (shown as "pickup not confirmed"). */
  pickupConfirmed: boolean;
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
}

export interface LadderView {
  planId: number;
  rungs: RungView[];
  kmin: number | null;
  final: boolean;
  notFound: NotFoundView[];
  unidentified: number;
  sources: SourceRunStatus[];
  skippedBasics: string[];
  unrecognised: string[];
  /** Cards that only one Source could be asked about. */
  partialCards: string[];
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
  | { type: 'error'; message: string };

export interface PrintingOption {
  printing: PrintingView;
  cheapest: number | null;
  stores: number;
  locked: boolean;
}

export interface PrintingsResponse {
  lineId: string;
  name: string;
  hint?: { text: string; lock: Lock | null };
  options: PrintingOption[];
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
