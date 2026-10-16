# Where do each Store's postage costs and location come from?

Research for issue #7 (parent map #1). Builds on #2 (`docs/research/fetch-tcg-access.md`) and #3
(`docs/research/mtgsingles-access.md`). Terms follow `CONTEXT.md` (Source, Store, Listing, Plan,
Landed Cost). All observations were made on **2026-10-16** from an NZ IP, read-only and at low
volume: about 40 page fetches, one per Store page. There were no accounts, logins, carts or form
submissions.

## TL;DR

- **Postage cannot be read programmatically without a cart.** Every route to a live quote goes
  through a basket:
  - Shopify's public `cart/shipping_rates.json` needs a cart with items (session cookie).
  - Fetch TCG's rates sit behind a signed-in `/v1/private/` endpoint.
  - Hobby Master is not on Shopify.

  Cart probing was out of scope here, so **postage has to come from a hand-maintained Store
  table**.
- **Location *can* be read programmatically for Shopify Stores.** The public, unauthenticated
  `https://<store>/meta.json` returns `city`, `province`, `country` and `ships_to_countries`.
  Fetch TCG Listings already carry `regionAddress.{city, allowPickups}` (#2). Hobby Master and
  Bay Dragon are not on Shopify, so their location is a one-off manual entry.
- **The policies are simple, and they fit one small model.**
  - Standard NZ postage is **a flat $5-$8 per parcel**, usually tracked (NZ Post / CourierPost).
  - Many Stores add **a rural surcharge** of about +$4 to +$9.
  - A few vary by **region** (Auckland / North Island / South Island).
  - Some have a **free-postage threshold** ($99-$250).
  - Weight-based pricing appears only for large parcels, so it doesn't matter for card singles.
- **About half the Stores publish no rates** ("shown at checkout"). These include Shuffle and
  Cut, Goblin Games, Iron Knight Gaming and Collectors Guild. For them, MagicFinder must use a
  **default assumption (suggest $7 tracked, +$5 rural)** until someone records the real figure.
- **A free-postage threshold makes a Store's postage a step function of its subtotal.** The Plan
  optimiser must evaluate postage *after* assigning Listings to a Store, not as a constant.

## 1. Survey of Store postage policies

Source for each row: the Store's `/policies/shipping-policy` page (Shopify) unless noted. "n/p"
means not published (rates shown only at checkout). All prices are NZD, domestic only.

| Store (MtgSingles key) | Location (meta.json / site) | Standard | Tracked? | Rural | Region-based? | Free over | Pickup |
|---|---|---|---|---|---|---|---|
| Card Merchant (main, `NZ/CardMerchant`) | Auckland (WestCity branch) | $5 "standard post" | not stated | $10 rural instead of $5 | No | none stated | not stated |
| Card Merchant Takapuna | Auckland | same text as main ($5 / $8 boxed / $10 rural) | not stated | $10 | No | none | not stated |
| Card Merchant Hamilton | Hamilton | n/p ("select at checkout") | - | - | - | none; combined shipping by email | **Yes, free over $5** (50c below) |
| Card Merchant Ponsonby / Silverdale / Wellington / Christchurch | Auckland ×2 / Wellington / Christchurch | n/p (no or empty policy page) | - | - | - | - | unknown |
| Hobby Master (`NZ/HobbyMaster`), *not Shopify* | Penrose, Auckland (`/page/Contact`) | from $6 | **Yes**, tracked courier, signature by default | **+$9** | No | **$100 on singles-only orders** (excludes any order containing sealed product) | **Yes, $2 handling fee** |
| Otakumart | Pokeno, Waikato | $7 urban courier | Yes (tracked, signed, insured) | $12 | No | **$200, incl. rural** | **No** ("unable to facilitate pickups") |
| TCG Collector NZ | Christchurch (Sydenham) | $7.50 | Yes | not distinguished | No | **$250** | Yes (Christchurch) |
| Game Roost | Auckland ("all items are shipped from Auckland") | $8 NI / $10 SI | tracking number given | $12 NI / $14 SI | **Yes, island** | none | **Yes, free** |
| Calico Keep | Paraparaumu | $5 "Trading Card Singles (Overnight)" | not stated | not stated | parcels by island/weight | none; "no combined shipping" | Yes, free |
| Nova Games | Albany, Auckland | $6 Auckland / $10 rest of NZ | tracking number given | not stated | **Yes, Auckland vs rest** | none | **Yes, free** |
| PlayX | Auckland | from $6.90 Akl / $9.90 NI / $12.90 SI | not stated | "small additional fee" | **Yes** | **$99** | not stated |
| Meta Life | Remuera, Auckland | $4.80 Akl / $8.80 NI & SI | CourierPost, tracking emailed | $6.80 Akl rural / $12.80 NI & SI rural | **Yes** | **$120 Akl / $160 elsewhere** | **Yes, click & collect** |
| The Game Tree | (not checked) | n/p | "exclusively tracked" | - | - | - | - |
| Shuffle and Cut (`NZ/ShuffleAndCut`) | Newmarket, Auckland | n/p | NZ Post, "tracked" | - | - | - | unknown (ships from Newmarket store) |
| Goblin Games | Karori, Wellington | n/p (NZ Couriers overnight) | courier | - | - | - | not stated |
| Iron Knight Gaming | Rangiora, Canterbury | n/p | tracking numbers | - | - | - | **Yes** (FAQ refers to in-store pickup option) |
| Magic at Willis | Christchurch (Linwood) | n/p (no shipping policy) | - | - | - | - | unknown |
| MTG Magpie (BinderPOS) | Christchurch | n/p (empty policy) | - | - | - | - | unknown |
| Badgers Sett | Whanganui | n/p (empty policy) | - | - | - | - | unknown |
| Collectors Guild | Auckland | n/p (no policy page) | - | - | - | - | unknown |
| HobbiXchange | Christchurch | n/p ("shown at checkout"); NZ Post, tracked | Yes | - | - | - | store pickup mentioned |
| Kanto Corner | New Plymouth | n/p ("displayed at checkout") | - | - | - | - | - |
| Bay Dragon, *not Shopify* | Flat Bush, Auckland (site footer) | not found | - | - | - | - | unknown |

Pages:
- `https://cardmerchant.co.nz/policies/shipping-policy`
- `https://cardmerchanthamilton.co.nz/policies/shipping-policy`
- `https://hobbymaster.co.nz/page/Order%20Instructions`, plus a homepage banner image stating
  "Spend $100 or more on single cards for free shipping. *excludes all orders with sealed products"
- `https://otakumart.co.nz/policies/shipping-policy`
- `https://tcgcollectornz.com/policies/shipping-policy`
- `https://gameroost.co.nz/policies/shipping-policy`
- `https://calicokeep.co.nz/policies/shipping-policy`
- `https://novagames.co.nz/policies/shipping-policy`
- `https://playx.co.nz/policies/shipping-policy`
- `https://metalife.co.nz/policies/shipping-policy`
- `https://thegametree.co.nz/policies/shipping-policy`
- `https://shuffleandcutgames.co.nz/policies/shipping-policy`
- `https://goblingames.nz/policies/shipping-policy`
- `https://ironknightgaming.co.nz/pages/faq-frequently-asked-questions`
- `https://magicatwillis.co.nz/pages/terms-conditions` (address only)
- `https://hobbixchange.co.nz/policies/shipping-policy`
- `https://kantocorner.nz/policies/shipping-policy`
- `https://baydragon.co.nz/` (footer)

### Patterns

- **Standard domestic postage is $4.80-$8 for an urban address.** The median of published
  figures is about $6-7. Nearly all Stores use NZ Post / CourierPost. Most "standard" options
  are already tracked courier. Card singles fit in a satchel, so cheaper untracked letter post is
  rarely offered domestically. (Hobby Master offers it only for Australia.)
- **Rural is the main variable**: +$4 to +$9 (Card Merchant $10 vs $5, Hobby Master +$9,
  Otakumart $12 vs $7, Game Roost +$4, Meta Life +$2 to +$4). It depends on the buyer's address,
  so MagicFinder needs a buyer-level "rural?" flag.
- **Region pricing (Auckland / North Island / South Island)** is used by about 4 of the 12 Stores
  with published rates. It also depends on the buyer, so MagicFinder needs a buyer region.
- **Free-postage thresholds are $99-$250** (PlayX $99, Hobby Master $100 singles-only, Meta Life
  $120/$160, Otakumart $200, TCG Collector $250). Conditions vary: Hobby Master excludes orders
  containing sealed product, which is irrelevant to singles-only Plans.
- **Weight or volume tiers** only kick in for parcels (Calico Keep, TCG Collector's "Large
  Shipment" over 10 kg). For a singles Want List this is negligible. Treat as out of scope.
- **Signature / boxed options** (Card Merchant $8 boxed, TCG Collector $9 signature) are upgrades.
  MagicFinder should use the cheapest tracked option unless the buyer opts otherwise.
- **Minimum order values** exist (TCG Collector: $2.50). These are rarely binding.
- **Each Card Merchant branch is a separate Shopify store** with its own policy. Some branches
  copy the main text, others (Hamilton) differ. Treat each branch as its own Store. This matches
  the MtgSingles keys (`NZ/CardMerchant<Branch>`).

## 2. Can postage be read programmatically?

| Route | Works without login? | Verdict |
|---|---|---|
| Shopify Ajax `GET /cart/shipping_rates.json?shipping_address[country]=…&shipping_address[zip]=…`, or `POST /cart/prepare_shipping_rates.json` + `GET /cart/async_shipping_rates.json` ([Shopify Ajax Cart API](https://shopify.dev/docs/api/ajax/reference/cart), "Generate shipping rates") | Yes, documented and public, but it quotes **the current cart**, so it needs an add-to-cart in a cookie session. Shopify notes `shipping_rates.json` "is subject to throttling". | **Not tested.** Creating carts on Stores was outside this ticket's read-only scope. It is technically feasible, but it means writing a cart on every Store per query. That's heavier and more intrusive than reading policies. Not recommended for routine use. If used, do it only occasionally to *verify* the table, with Stores' permission. |
| Shopify `/policies/shipping-policy` | Yes | Free text. Present on most Shopify Stores but **empty or missing on about 40%** of those checked. Not machine-parseable reliably. Useful as a change-detection signal. |
| Fetch TCG `/v1/private/market/shipping-rates/eligible` | No (signed in) | Not usable (#2). |
| Hobby Master (custom platform) | - | Rates only in a prose page. |
| MtgSingles API | - | No postage or location fields (#3). |

**Conclusion: postage must be a maintained table.** Seed it from the policy pages above. Where a
Store publishes nothing, fall back to a configurable default.

## 3. Can location be read programmatically?

- **Shopify `/meta.json`** (public, no auth, one request per Store) returns
  `city`, `province`, `country` and `ships_to_countries`. Verified on 17 Stores; Hobby Master
  (not Shopify) returned nothing. Examples:
  - Hobby Master → nothing
  - `shuffleandcutgames.co.nz` → Auckland
  - `ironknightgaming.co.nz` → Rangiora, Canterbury
  - `otakumart.co.nz` → "RD1 Pokeno", Waikato
  - `cardmerchanthamilton.co.nz` → Hamilton, Waikato
  - `badgerssettnz.com` → Whanganui

  Caveats:
  - This is the shop's **business address**, not necessarily a pickup point.
  - It doesn't say whether pickup is offered.
  - `city` can be messy ("RD1 Pokeno").
  - Treat it as a seed, confirmed by a human.
- **Fetch TCG**: each Listing carries `regionAddress.{suburb, city, latitude, longitude, allowPickups}`
  (#2). This is per Store and authoritative, so no table is needed for Fetch Store location or
  pickup.
- **Pickup availability** for Shopify Stores is a checkout delivery method. It's not exposed
  without a cart. The theme's `pickup-availability` section (`/variants/<id>/?section_id=pickup-availability`)
  returned 404 on Nova Games, so it's not reliable. **Pickup must be a table field**, seeded from
  policy pages (§1).

### Auckland pickup-eligible Stores found

Pickup is stated explicitly for:
- Hobby Master (Penrose, $2 fee)
- Nova Games (Albany, free)
- Game Roost (free)
- Meta Life (Remuera, click & collect)

These are Auckland by location, with pickup unconfirmed:
- Card Merchant main (WestCity)
- Ponsonby, Takapuna and Silverdale branches
- Shuffle and Cut (Newmarket)
- Collectors Guild
- PlayX
- Bay Dragon (Flat Bush)

## 4. Recommended data model

One record per **Store**, keyed by the Store's id within its Source. A Store found on two
Sources (e.g. Hobby Master via MtgSingles, and possibly also selling on Fetch) is linked by an
optional shared `store_id`.

```yaml
# data/stores.yaml  (hand-maintained; one entry per Store)
- store_id: hobby-master
  name: Hobby Master
  source_keys:            # how Listings from each Source map to this Store
    mtgsingles: NZ/HobbyMaster
    # fetch: <listedByUserId>   # if the same business also sells on Fetch
  site: https://hobbymaster.co.nz
  location:
    city: Auckland
    region: Auckland        # NZ region; drives Auckland/NI/SI pricing and pickup eligibility
    country: NZ
  pickup:
    available: true
    fee: 2.00
    note: Penrose events centre, next business day
  postage:                # buyer-facing options; MagicFinder picks the cheapest that fits the buyer
    - name: Tracked courier
      tracked: true
      price: 6.00
      rural_surcharge: 9.00     # or rural_price
      regions: all              # or {auckland: 6, north_island: 9.9, south_island: 12.9}
  free_postage:
    threshold: 100.00
    applies_to: singles_only    # all | singles_only
  min_order: null
  provenance:
    url: https://hobbymaster.co.nz/page/Order%20Instructions
    checked_on: 2026-10-16
    confidence: published       # published | inferred | default
```

Rules for computing a Store's postage in a Plan (for Landed Cost):

1. Inputs are the buyer profile (region, rural yes/no, wants pickup, require tracked) and the
   Store's subtotal in this Plan.
2. If the buyer chooses pickup and `pickup.available`, postage = `pickup.fee`. Pickup applies
   only when the buyer is in the same region as the Store (Auckland for this project).
3. Otherwise take the cheapest option that satisfies `tracked` if required. Apply the region
   price and the rural surcharge.
4. If `free_postage.threshold` is set and subtotal ≥ threshold, postage = 0.
5. If the Store has no postage record (`confidence: default`), use the global default (**$7.00
   tracked, +$5 rural**; user-editable). Show it in the UI as an estimate.

**Fetch TCG Stores** are numerous, often private sellers, with rates hidden behind sign-in (#2).
Model them with the same structure, but default every Fetch Store to the global default unless
the user overrides it. Use the Listing's `allowPickups` and `city` for pickup and location.

### Implication for the Plan optimiser

The free-postage threshold makes postage a **non-linear step** in each Store's subtotal. A Plan
that moves one more card to a Store can drop that Store's postage to $0. The Trade-off Ladder
search must recompute postage per Store from the final assignment rather than treat it as a
fixed per-Store constant. A greedy or ILP formulation can model it with one binary "threshold
reached" variable per Store.

## 5. How the table is maintained

- **Format:** a checked-in `data/stores.yaml` (or JSON) in the repo, reviewed by a human. About
  40-50 NZ Stores from MtgSingles plus any notable Fetch businesses: small enough to curate by
  hand.
- **Seeding:**
  - Location comes from `/meta.json` (Shopify) or the Fetch Listing.
  - Postage and pickup come from the policy pages in §1.
  - Unknown values get `confidence: default`.
- **Change detection (recommended, low volume):** a monthly script.
  1. Fetch each Store's `/policies/shipping-policy` (or known policy URL) and `/meta.json`.
  2. Hash the extracted text.
  3. Open a GitHub issue listing the Stores whose text changed, for a human to update the YAML.

  That's one or two requests per Store per month, with no carts and no parsing of free text into
  numbers automatically.
- **User overrides:** let the buyer edit any Store's postage locally. They often know their
  regular Stores' rates from past orders. This is also the only practical source for Stores that
  publish nothing.
- **Optional:** ask the "n/p" Stores (Shuffle and Cut, Goblin Games, Iron Knight Gaming,
  Collectors Guild) for their singles postage rates. That is a human task for the project owner,
  not something to automate.

## 6. Open risks and unknowns

- **About half the Stores publish no rates.** Their postage is a guess until verified. The $7
  default may be off by ±$3 per parcel, which can change which Plan is cheapest at the margin.
- **Rates go stale silently.** Some policy pages are out of date relative to checkout. For
  example, Hobby Master's own page contradicts itself on whether the threshold excludes sealed
  product. Checkout is the only ground truth, and we don't read it.
- **Pickup is a weak signal.** `meta.json` gives a business city, not a pickup service. Fetch's
  `allowPickups` is per Store and reliable.
- **Shopify cart-based quotes were not tested.** If the project later wants exact quotes, test
  `prepare_shipping_rates` / `async_shipping_rates` once, and seek the Store's OK first.
- **Card Merchant branch structure**: the MtgSingles About grid lists branches (Blenheim, Dunedin,
  New Plymouth, Taupō, …) beyond those whose policies were checked here. Each needs its own row.
- **Signature / insured / boxed upgrades and international rates** were deliberately ignored.
  The scope is NZ buyers ordering singles.
