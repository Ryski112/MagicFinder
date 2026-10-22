# Sources and Stores: limits and quirks

Each rule here was learned from a bug. Read the section for whatever you are changing; when a Source misbehaves, check here before the planner.

## Pacing

- Fetch TCG: one request a second (`src/sources/fetchTcg.ts`). Store carts: one a second per host (`src/server/cart.ts`).
- MtgSingles: one request every **1.5 s**, shared by every search (`src/server/main.ts`). At 1 a second Cloudflare answers 429 with `Retry-After: 10` after about 30 requests; at 1.5 s a 120-card run had no 429s and finished sooner.

## MtgSingles

- Cloudflare returns 403 to any request without `Referer: https://www.mtgsingles.co.nz/`. With it, plain `fetch` works; MtgSingles is read over HTTP, with no browser (the headless Chrome was removed in PR 25).
- A 429 is **Slowed down**: wait for `Retry-After`. It is never **Down**. Counting it as Down once failed MtgSingles for whole runs.
- GitHub's runners get 403 from MtgSingles whatever the headers. So `au-store-check.yml` only re-checks Australian Stores already in `data/stores.yaml`; new ones are found by the hosted server's weekly check or a local `npm run probe-au -- --write`.

## CardKingdom pricelist

`api.cardkingdom.com/api/v2/pricelist`:

- `price_retail` is the NM price, but `qty_retail` counts every condition. Price copies from `condition_values`, using only the in-stock conditions at or above the buyer's minimum condition (PR 65).
- `is_foil` is only true or false, so etched foils appear as foil. Map them to etched when the Printing is etched-only (PR 64).
- Phyrexian and Japanese rows carry `scryfall_id`s that aren't in the English catalogue. They stay unmatched on purpose: they aren't like-for-like.

## Shopify checkout probes

Reading a Store's postage through `/cart/shipping_rates.json` (`scripts/checkoutRates.ts`):

- A cart keeps the rates of the first address it was asked about. Use a fresh cart (new `add.js`, new cookie) for each address.
- Shopify quotes in the visitor's market currency: some AU shops quote NZD from NZ, and GitHub's US runners get USD. Add `?country=NZ` to `add.js` and read each rate's `currency`.
- 422 `{"country":["Country/region not supported"]}` means no shipping zone covers that country.
- An empty rate list means "doesn't ship" only if a home address (Sydney) gets rates; some checkouts return nothing for anyone.
- `meta.json`'s `ships_to_countries` disagrees with checkout; trust checkout.
- When `products.json`'s first pages are sold out, `/search/suggest.json?...&resources[options][unavailable_products]=hide` finds an in-stock product to put in the cart.
