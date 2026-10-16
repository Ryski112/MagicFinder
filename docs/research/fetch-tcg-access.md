# Fetch TCG: searching and reading Listings

Research for issue #2 (parent map #1). Investigated 2026-10-16 against the live site
(`www.fetchtcg.com`), its JSON API (`api.fetchtcg.com`), robots.txt, Terms of Service, FAQ and the
site's own JavaScript bundles. Terms follow `CONTEXT.md` (Source, Store, Listing, Printing,
Landed Cost).

## Answer in brief

- Fetch TCG is a Next.js front end over an **undocumented, unauthenticated JSON API at
  `https://api.fetchtcg.com`**. Prices and Listings are not in the server-rendered HTML; the
  browser loads them from this API with XHR. **No headless browser and no HTML scraping are
  needed.**
- **One request per card name** returns every active Listing across all Printings in a country:
  `GET https://api.fetchtcg.com/v1/market/listings?cardName=<name>&gameIds=mtg&countryCode=NZ&currencyCode=NZD&size=200&page=0`
- Each Listing carries the Store (seller id, profile name, business name, "business" flag,
  rating), the Store's suburb/city/country and coordinates, the Printing (set, collector
  number, finish, rarity, Scryfall id), condition, remaining quantity, price and currency, and a
  listing id that maps to a public URL.
- **Postage is not public.** It is charged per Store (per seller group in the cart). The Store
  sets the rates, and they are only returned by authenticated `/v1/private/...` endpoints during
  checkout. MagicFinder will need a postage model or assumption for Fetch Stores; see Open risks.
- **ToS:** the Terms say users must not "use automated systems to access our Services without
  permission". robots.txt allows the public marketplace pages. A **Developer API** exists, but it
  sits behind sign-in, is aimed at Stores connecting POS/inventory software, and is being rolled
  out per account. Fetch's permission is the clean way to use the API (contact
  hello@fetchtcg.com).

## How the site loads data (observed)

The marketplace pages render a shell. The browser then calls `api.fetchtcg.com`, which runs
behind Cloudflare and returns Spring-style paged JSON. Requests observed in the browser's
resource timing:

| Page | API calls |
|---|---|
| `/marketplace/games/mtg?q=Lightning+Bolt` (Printing search) | `GET /v3/cards?pageSize=48&pageOffset=0&sort=RELEVANCE_DESC&cardName=Lightning+Bolt&gameIds=mtg`, then `GET /v3/cards/{cardId}` per result, plus `GET /v3/filters/cards?...` |
| `/cards/{cardId}/{slug}` (one Printing) | `GET /v3/cards/{cardId}`, `GET /v3/cards/{cardId}/listings?countryCode=NZ&currencyCode=NZD&pageSize=20&sort=PRICE_ASC`, price history endpoints |
| `/marketplace/listings?q=Sol+Ring&gameId=mtg` (Listing search) | `GET /v2/market/listings/ids?sort=RELEVANCE&countryCode=NZ&cardName=Sol+Ring&gameIds=mtg&pageOffset=0&pageSize=48` (ids only), then `GET /v1/market/listings/{id}?currencyCode=NZD` per id |
| `/profiles/{profileName}` (Store page) | `GET /v2/market/listings/ids?...&profileName=...`, then per-listing `GET /v1/market/listings/{id}` |
| `/cart` | Authenticated: `/v1/private/market/shipping-rates/eligible?lines=<listingId>:<qty>,...&currencyCode=NZD` |

Some calls are view counters (`/v3/cards/{id}/view`, `/v3/cards/listing/{id}/view`,
`/v1/social/{profile}/view`). MagicFinder must **not** call these.

The site's JS also uses `GET /v1/market/listings` with filter parameters (Store pages call it
with `profileName=...&size=12&page=0`). Called directly with `cardName`, it returns **full
Listing objects in one call** instead of ids. This is the recommended endpoint:

```
GET https://api.fetchtcg.com/v1/market/listings
    ?cardName=Sol+Ring&gameIds=mtg&countryCode=NZ&currencyCode=NZD&size=200&page=0
```

Verified behaviour (curl, 2026-10-16):

- Works with no cookies, no auth and no `Origin` header (plain `curl` UA returned 200).
- `size=200` and `size=1000` were honoured. "Sol Ring" NZ returned all 156 hits in one page
  (~500 KB, ~0.5 s); "Lightning Bolt" NZ returned 69 hits.
- `countryCode=NZ` returns only NZ-listed Listings and `countryCode=AU` only AU. Omitting it
  returned NZ results; it may default from the caller's IP (the requests went through
  Cloudflare's Auckland edge), so always pass it explicitly.
- `currencyCode=NZD` converts AU Listings: each item keeps `listedPrice`/`listedCurrency`
  (e.g. 183.00 AUD) and adds `listedPriceInRequestedCurrency`/`requestedCurrency`
  (225.39 NZD).
- Response shape: `{ "searchResults": { "content": [...], "totalElements", "totalPages",
  "number", "size", "last", ... }, "filters": null }`. Paginate with `page` until `last`.
- **CORS** reflects any `Origin` with `access-control-allow-credentials: true`, so a browser
  app could call it directly. A server-side fetch is still preferable for caching and
  politeness.
- No rate-limit headers (`X-RateLimit-*`, `Retry-After`) appeared, and no limits are
  documented. Cloudflare may still challenge or block heavy traffic.

### Name matching is fuzzy: filter results client-side

`cardName` is a relevance/token search, not an exact match:

- "Sol Ring" (NZ) gave 156 hits, of which 59 were Sol Ring. The rest included "Soldier of the
  Grey Host", "Galadhrim Bow" and "One Ring to Rule Them All".
- "Lightning Bolt" gave 69 hits, including "Ball Lightning" and "Thrum of the Vestige - Lightning
  Bolt (Showcase)".
- Fetch's card names carry treatment suffixes: "Lightning Bolt (Borderless)", "Lightning Bolt
  (Japanese)", "Sol Ring (…)", and Secret Lair alternate names like "Lightning Bolt - Hadoken".
- Double-faced cards are named `Front // Back`, e.g. "Delver of Secrets // Insectile
  Aberration". Searching either face works ("Insectile Aberration" returned 14 hits, all Delver).
  "Delver of Secrets" gave 83 hits, of which only about 14 were Delver.

Recommendation: match each Listing to the Want List card by `card.externalReferences.scryfallId`
and resolve that to an oracle name with Scryfall. Do not compare name strings. Fallback: strip
a trailing `( … )` group and compare the front face before ` // `.

## Fields per Listing (`/v1/market/listings` item)

Taken from real responses (Listings 644536, 1357725, 315791 for Lightning Bolt M10 #146):

| Need | Field(s) | Notes |
|---|---|---|
| Listing id / URL | `id` | Public page: `https://www.fetchtcg.com/marketplace/listings/{id}`. Printing page: `https://www.fetchtcg.com/cards/{card.id}/{urlName}` |
| Store identity | `listedByUserId` (stable id), `sellerProfileName` (URL handle, `/profiles/{name}`), `sellerBusinessName` (present for stores), `business` (bool), `sellerRating` | A **Store** = `listedByUserId`. Both businesses and private individuals sell (C2C marketplace) |
| Store location | `listedCountry` (`NZ`/`AU`), `regionAddress.{suburb, city, country, latitude, longitude, allowPickups}` | `city` is sometimes a region ("Otago Region", "Canterbury Region"); `postCode` was null |
| Printing | `card.id` (e.g. `mtg_146_c_m10_normal`), `card.name`, `card.cardCode` (collector number), `card.set.{id, name, displayName, releaseDate}`, `card.printVersion.code` (set code, e.g. `m10`), `card.rarity`, `card.externalReferences.{scryfallId, tcgId}` | Card id pattern is `mtg_<collector>_<rarity>_<set>_<finish>`, with exceptions (e.g. `mtg_MSC-806_U_standard_foil`) |
| Treatment / foil | `card.printFinish.name` (`normal` / `foil`); other treatments only in `card.name` suffix, e.g. "(Borderless)", "(Retro Frame)", "(Showcase)" | Each finish is a separate Fetch card id, so one Fetch card id is one Printing |
| Condition | `condition` (`raw-m`, `raw-nm`, `raw-lp`, `raw-mp`, `raw-hp`, `raw-d`), `conditionLabel` ("Near Mint", "Heavy Play") | Graded items also exist on the platform |
| Language | **No language field.** Non-English printings appear as separate cards with a name suffix ("Lightning Bolt (Japanese)", "(JP Alternate Art)") | Treat a missing suffix as English. The seller's free-text `details` may say otherwise |
| Quantity | `remainingQuantity`, `maxPerBuyer` (usually null) | |
| Price / currency | `listedPrice` + `listedCurrency`, `listedPriceInRequestedCurrency` + `requestedCurrency` | NZD for NZ Stores |
| Availability | `status` (`ACTIVE`), `sellerOnHoliday`, `holidayMessage`, `buyNowEnabled`, `offerEnabled` | See the buy-now risk below |
| Shipping weight | `weightGrams`, `measuredWeightGrams` | Null on every single sampled |
| Other | `listedAt`, `details` (seller notes), `supportedPaymentMethods`, `productType` (`SINGLE`) | |

Per-Printing summary data (`GET /v3/cards/{cardId}`) adds `listingsData.{NZ,AU}.{condition}.
{minListedPrice, avgListedPrice, totalListings}` and TCGplayer/Card Kingdom reference prices.
That is useful for a cheap "anything in stock?" pre-check, but not needed if
`/v1/market/listings` is used.

## Postage

- The cart groups items **per seller**. The front end keeps `deliveryModeBySeller`
  (`delivery` / `pickup`), `selectedShippingPriceIdBySeller` and `shippingCostBySeller`, and
  computes each seller's total as cards + shipping + processing fee (cart page JS bundle
  `page-d9d2bf065bddc9a7.js`). So postage is **per Store**, which matches the Landed Cost model.
- Stores configure their own rates (seller settings route `/settings/shipping-rates`, API
  `/v1/private/shipping-prices`). The FAQ says shipping is "calculated based on the item's
  weight, destination, and shipping method selected. Sellers can choose from various shipping
  options and rates are displayed before purchase." The Terms add that sellers may specify which
  regions they ship to.
- Rates for a basket come from `GET /v1/private/market/shipping-rates/eligible?lines=<listingId>:<qty>,...&currencyCode=NZD`
  (rates have `id`, `title`, `total`, `currencyCode`, `eligible`). This sits under
  `/v1/private/` and needs a signed-in session. Not called in this research (read-only, no
  login).
- Listings with `regionAddress.allowPickups=true` offer pickup at $0 shipping.
- Other Landed Cost terms: for NZ purchases, a **card payment surcharge** is added at checkout
  (Terms §8; amount not stated). AU purchases have no buyer surcharge.

There is no public way to read a Store's postage. Options for MagicFinder: (a) assume a flat
per-Store postage figure, configurable by the user; (b) ask Fetch for access; (c) let the user
supply known rates for frequently used Stores. Weight-based rates and missing `weightGrams` mean
even an authenticated call would need a basket per Store.

## robots.txt, Terms and permission

- `https://www.fetchtcg.com/robots.txt` (fetched 2026-10-16):
  `User-Agent: *`, `Allow: /`, `Disallow: /account/ /messages/ /sell/ /auth/`, plus sitemaps.
  The public marketplace pages are allowed. `api.fetchtcg.com/robots.txt` returns 404 (none).
- Terms of Service (`/policies/terms`, "Last updated: October 2026"), §7 Prohibited Conduct:
  "You agree not to … Use automated systems to access our Services without permission" and
  "Interfere with the proper functioning of our Services". §10 IP: users may not "copy, modify,
  distribute, or create derivative works from our platform without our express written
  permission". The listing data itself is user-uploaded content licensed to Fetch.
  The Terms bind "by creating an account or using our Services". MagicFinder calling the API
  automatically, even politely, is arguably "automated access without permission".
- **Developer API**: `/developers` says "Sign in to read the developer documentation". For
  accounts without the feature it says it is "available to stores in the Developer API rollout.
  If you run your own point-of-sale or inventory software and want to connect it to Fetch, get
  in touch and we'll enable it for your account". Docs are an OpenAPI file served from
  `/v1/private/apps/docs/openapi.yaml`, and its routes appear to sit under `/v1/integration`. It is
  seller/inventory-oriented, and nothing suggests it offers buyer-side search.

## Recommended access approach

1. **Ask Fetch for permission** (hello@fetchtcg.com), describing low-volume, user-triggered
   price comparison that links back to Fetch Listings. Ask whether a read endpoint or the
   Developer API can expose seller shipping rates.
2. Until then, or if permission is granted for the public API: implement the Fetch Source as a
   **server-side HTTP client** over `GET /v1/market/listings` (one call per Want List card,
   `countryCode=NZ`, `currencyCode=NZD`, `size=200`, paginate on `last`). Optionally also query
   `countryCode=AU` if AU Stores that ship to NZ are wanted. AU shipping eligibility is unknown
   without the cart endpoint.
3. Be polite: one request at a time with ~1 s spacing, an identifying User-Agent with a contact,
   a cache of results for some minutes, no view-counter endpoints, and a back-off on 429/403 or
   Cloudflare challenges.
4. Map Listings to Want List cards by `scryfallId`. Key Stores by `listedByUserId`. Link to
   `/marketplace/listings/{id}`.
5. Treat postage as a configurable per-Store assumption (with pickup = $0 as an option) until
   real rates can be obtained.

## Open risks and unknowns

- **ToS / permission**: automated access without permission is prohibited, so the main risk is
  legal or relational rather than technical. Fetch could block the client or object.
- **Undocumented API**: paths are versioned (`v1`/`v2`/`v3`) and can change without notice. The
  front end is migrating to v2/v3 for listing searches; `/v1/market/listings` may be retired.
- **Postage unknown**: per-Store rates, regions shipped to and free-shipping thresholds are not
  public. This directly affects Landed Cost accuracy.
- **Buy-now vs offer**: many Listings have `buyNowEnabled=false, offerEnabled=true`. For Sol
  Ring NZ, 41 of 59 were offer-only. The card page still shows "Add to cart" for them, and the
  JS distinguishes a `buy_now` checkout mode (with a processing fee) from others. The FAQ
  mentions buyers paying within 3 business days "after making an offer". Whether offer-only
  Listings can be bought at list price straight away is unconfirmed. This affects whether
  they belong in a Plan.
- **Name matching**: fuzzy search and name suffixes mean false positives unless filtered by
  Scryfall id. Some Fetch cards may lack a `scryfallId`; this was not checked at scale.
- **Language**: no field exists; only name suffixes signal it.
- **Default country**: results without `countryCode` may depend on caller IP or region.
- **Rate limits**: none advertised. Cloudflare bot protection may challenge server IPs, such as
  cloud hosts.

## Sources

- https://www.fetchtcg.com/robots.txt
- https://www.fetchtcg.com/policies/terms (§2, §4, §7, §8, §10)
- https://www.fetchtcg.com/faq ("How is shipping calculated?", payment after offers)
- https://www.fetchtcg.com/developers (signed-out view plus its JS bundle strings)
- Browser network/resource timing on `/marketplace/games/mtg?q=…`, `/cards/mtg_146_c_m10_normal/…`,
  `/marketplace/listings/644536`, `/marketplace/listings?q=Sol+Ring`, `/profiles/TCG_Fanatics`, `/cart`
- Direct API responses: `api.fetchtcg.com/v3/cards?…cardName=…`, `/v3/cards/mtg_146_c_m10_normal`,
  `/v3/cards/mtg_146_c_m10_normal/listings?…`, `/v1/market/listings/644536?currencyCode=NZD`,
  `/v1/market/listings?cardName={Sol Ring, Lightning Bolt, Delver of Secrets, Insectile Aberration}&countryCode={NZ,AU}…`
- Front-end JS chunks (`/_next/static/chunks/…`, deployment `dpl_DBQ3uCXop6N3BoA4CNFqugcJ7NR4`)
  for the cart/shipping logic and the private shipping endpoints
