# Can each Store's cart be pre-filled from a Plan?

Research for issue #15 (parent map #1). It builds on three earlier notes:
- #2: `docs/research/fetch-tcg-access.md` on `research/fetch-tcg-access`
- #3: `docs/research/mtgsingles-access.md` on `research/mtgsingles-access`
- #7: `docs/research/store-postage.md` on `research/store-postage`

Terms follow `CONTEXT.md` (Source, Store, Listing, Printing, Plan).

All observations were made on **2026-10-17** from an NZ IP. Volume was low and access was
read-only, apart from the cart tests:
- one homepage request per Store, about 40 in total
- 12 `meta.json` requests for the Card Merchant branches
- 4 `products/<handle>.js` lookups
- one MtgSingles search ("Lightning Bolt"), run from inside the MtgSingles page as #3 recommends
- cart tests on **one** Shopify Store (TCG Collector NZ), using **anonymous** carts only. Each
  cart was cleared afterwards.

There was no sign-in, no account, no personal data and no checkout. Fetch TCG was read signed
out only.

## TL;DR

- **Shopify Stores can get a real "Add all to cart".** 44 of the 50 NZ Store sites behind
  MtgSingles run Shopify, counting the Card Merchant branches. 41 of those are live. 16 of the
  44 run the BinderPOS app.

  Shopify's documented cart permalink is
  `https://<store>/cart/<variantId>:<qty>,<variantId>:<qty>?storefront=true`. It fills the cart
  with several lines and quantities in one link and lands the buyer on the Store's cart page.
  Without `storefront=true` it lands on checkout. This was verified live.
- **The permalink replaces the cart.** It doesn't add to what's already there. Whatever the
  buyer already had in that Store's cart is gone (observed).
- **The permalink doesn't check stock.** A sold-out variant and an over-stock quantity both went
  into the cart with no warning on the cart page. The problem would only surface at checkout.
  So MagicFinder must **re-check each line just before building the link**: one
  `products/<handle>.js` call per Listing.
- **The link needs Shopify variant ids, and MtgSingles mostly doesn't give them.** Only a few
  Listing `url`s carry `?variant=` (Otakumart did). The rest are `…/products/<handle>`.

  One public `GET /products/<handle>.js` per Listing returns every variant. Pick the one that
  matches the Listing's condition and foil. Titles are like "Near Mint" or "Lightly Played
  Foil". SKUs follow `<SET>-<num>-<LANG>-<NF|FO>-<1..5>`. Confirm the pick with the price and
  the `available` flag.
- **There is no cart link for the other Stores.** Each gets "Open Listings" instead: one tab
  per Listing, or the Store's own bulk-entry page. The Stores are:
  - Hobby Master: custom. AJAX POST only, but it has a `/deck-builder` paste box.
  - Bay Dragon: custom Java. POST form only.
  - Magic Red Dragon: Wix.
  - Vagabond: BigCommerce. Its add URL takes one product per request.
  - Games Lab: Ecwid. JS API only.
  - Hobby Lords: unknown, behind a Cloudflare challenge.
- **Fetch TCG has no add-to-cart link.** It has a single marketplace cart, stored server-side
  (`/v1/private/market/cart`) and keyed by listing id. The cart only shows after sign-in
  ("Login to view cart").

  Lines are grouped per seller at checkout, but it is **one cart for all Stores**. Filling it
  would mean calling the private API with the buyer's Firebase token. That is automated access
  the Terms forbid without permission, and it means handling the buyer's credentials.

  **Fallback:** open each Fetch Listing page (`/marketplace/listings/{id}`) so the buyer clicks
  "Add to cart" themselves.

## 1. Fetch TCG

### How the cart works (observed, signed out)

- `https://www.fetchtcg.com/cart` signed out shows "Login to view cart … Sign in to see your
  cart and complete purchases".
- Nothing about the cart is kept in the browser. There is no cart key in localStorage or
  sessionStorage, and only analytics cookies.
- The cart is a server-side resource. These calls come from the front-end JS chunks
  (`9626-e0cce6733e818450.js`, `4737-45db279596da803d.js`, deployment
  `dpl_DBQ3uCXop6N3BoA4CNFqugcJ7NR4`):
  - `GET /v1/private/market/cart`: read the cart
  - `POST /v1/private/market/cart` (JSON body, mutation `addToCart`): add a line
  - `PUT /v1/private/market/cart/{listingId}` (`updateCartLine`)
  - `DELETE /v1/private/market/cart/{listingId}` (`deleteCartLine`)
  - Guest-cart plumbing: `POST /v1/private/market/cart/handoff`, `…/cart/linking`,
    `…/cart/linking/abort`, `…/cart/merge` (header `X-Guest-Cart-Handoff`) and `…/cart/claim`.
    These use Firebase *anonymous* users, with analytics events `GUEST_TO_LOGIN_CONVERSION` and
    `GUEST_CART_MERGE_RESULT`. Fetch is building or rolling out a guest cart that merges into the
    account on sign-in. Every one of these routes is `/private/` and needs a Firebase ID token.
- The cart and shared chunks read **no add-to-cart query parameter**. The only `searchParams`
  keys found are payment/OAuth ones (`payment_intent`, `redirect_status`, `state`, `code`,
  `error`, …), `invitedBy` and `sessionToken`. **No deep link that fills the cart was found.**
- It is **one marketplace cart**. Lines are keyed by listing id, and the cart page groups them by
  seller for postage (`deliveryModeBySeller`, `shippingCostBySeller`; #2). The buyer can't have
  one cart per Store. Every Fetch Store in a Plan goes into the same cart, and the buyer checks
  out once with a parcel per seller.

### ToS

Terms (`/policies/terms`, Oct 2026), §7: users must not "use automated systems to access our
Services without permission".

Pre-filling the cart could only be done in one of two ways:
- MagicFinder calls `POST /v1/private/market/cart` with the buyer's Firebase token.
- A browser automation clicks "Add to cart" in the buyer's signed-in session.

Both are automated access to a private, authenticated API. They need Fetch's permission. The
first also means MagicFinder holding the buyer's session token. **Don't build either.**

Opening Fetch's public Listing pages in the buyer's browser is ordinary linking, and the buyer
clicks "Add to cart" themselves. That raises no ToS issue.

### What to build for Fetch

- The button becomes **"Open N Listings on Fetch"**. It opens
  `https://www.fetchtcg.com/marketplace/listings/{id}` for each Listing (or a list of links in the
  Plan with "open all"). The buyer adds each one to the single Fetch cart.
- Show a note: "Fetch uses one cart for every seller. Items from all Fetch Stores in this Plan
  check out together."
- Offer-only Listings (`buyNowEnabled=false`, #2) should be flagged, because they may not be
  addable at list price.
- If Fetch grants permission later, ask whether they support a cart deep link, e.g.
  `/cart?add=<listingId>:<qty>,…`. The `lines=<listingId>:<qty>` format already exists on their
  shipping-rates endpoint, so it would be a small feature for them.

## 2. MtgSingles Stores: platform survey

Method: one `GET /` per Store domain from the #3 Store table. Each was fingerprinted from the
response:
- Shopify: `cdn.shopify.com` / `Shopify.shop`
- BinderPOS: `binderpos` in the page
- BigCommerce: `bigcommerce.com` assets
- Wix: `wixstatic`, `server: Pepyaka`
- Ecwid: `ecwid_html`, `generator: ec-instant-site`

The Card Merchant branches were confirmed through `/meta.json`, which gives `myshopify_domain`.

| Platform | Count | Stores |
|---|---|---|
| **Shopify + BinderPOS** | 16 | Badgers Sett, BeaDnD Games, Calico Keep, Card Bard, Card Merchant (main), Card Merchant Hamilton, Gaming DNA, Magic at Willis, MTG Magpie, Nova Games, NZ Trading Cards, Otaku Mart, Spellbound, TCG Collector NZ, TCG Culture, XP Games¹ |
| **Shopify (other)** | 18 | Bulbastore, Card Baron¹, Card Masters, Card Slayer², Card Spot (now `cardspot.store`), Collectors Guild, Game Roost, Goblin Games, HobbiXchange, Iron Knight Gaming, Kanto Corner, Meta Life, PlayX, Pop Stop, Shuffle and Cut, The Game Tree, Three Tree Market, Valkyrie Games (`valkyriegames.co.nz`) |
| **Shopify, Card Merchant branches** | 10 more confirmed | Blenheim, Christchurch, Dunedin, Nelson, New Plymouth, Ponsonby, Takapuna, Taupō, Wellington, Whangārei (`meta.json` → `*.myshopify.com`). Silverdale returned 301 and wasn't followed. |
| Custom (PHP, Werlix Studios) | 1 | Hobby Master |
| Custom (Java servlet, `jsessionid`) | 1 | Bay Dragon |
| Wix | 1 | Magic Red Dragon |
| BigCommerce | 1 | Vagabond |
| Ecwid (Lightspeed E-Series) | 1 | Games Lab |
| Unknown | 1 | Hobby Lords (Cloudflare "Just a moment…" challenge, which was not bypassed) |

¹ Card Baron and XP Games currently redirect to `/password`, which means a password-protected
Shopify store. Shopify documents that "cart permalinks can't bypass storefront passwords".
² Card Slayer returns HTTP 402 "Store unavailable", a paused Shopify store.

**44 of 50 Store sites are Shopify (16 + 18 + 10), and 41 of them are live** once Card Slayer,
Card Baron and XP Games are excluded. Shopify Stores also carry
most of the Listings. In the Lightning Bolt sample, the non-Shopify Listings were mostly Hobby
Master, plus Bay Dragon and Magic Red Dragon.

WooCommerce: none found. `wp-content` appears on Meta Life and PlayX only as an image URL for
the POLi payments logo; both are Shopify.

## 3. Cart links per platform

### Shopify: cart permalinks (documented, verified)

Docs:
- [Shopify Help, cart permalinks](https://help.shopify.com/en/manual/products/details/cart-permalink)
- [shopify.dev, create cart permalinks](https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks)

- Format: `https://<store>/cart/<variant_id>:<qty>,<variant_id>:<qty>`. It takes several lines
  with quantities in one link.
- By default the link goes **to checkout**. `storefront=true` "redirects to the online store
  cart instead of checkout". The help page says this gives buyers "the opportunity to add or
  modify their cart before proceeding to checkout". **Use `storefront=true`**: the buyer reviews
  the cart, and MagicFinder never lands anyone directly in checkout.
- Other documented parameters: `discount`, `note`, `attributes[...]`, `ref` (referral code shown
  to the merchant), `checkout[email]` / shipping address pre-fill, `access_token` /
  `source_name` (sales-channel apps only) and `payment=shop_pay`.
  - **Don't pre-fill any buyer data.**
  - `ref=magicfinder` could tell Stores where the order came from. That is optional, and worth
    asking a Store about first.
- Limits: selling plans aren't supported, and permalinks don't bypass storefront passwords. No
  maximum line count is documented. URL length is the practical limit: about 20 bytes per line,
  so 100 lines is about 2 KB, which is fine.

Live test on TCG Collector NZ (anonymous curl cookie jar, then once in a browser; carts cleared
afterwards). Variant A = Lightning Bolt FDC-163 Near Mint (`available: true`, MtgSingles qty 1).
Variant B = the same card Lightly Played (`available: false`).

| Step | Request | Redirect | Cart afterwards (`/cart.js`) |
|---|---|---|---|
| T1 | `/cart/A:1?storefront=true` | 302 → `/cart?cart_link_id=…` | A×1 |
| T2 | `/cart/B:1,A:3?storefront=true` (same session) | 302 → `/cart?cart_link_id=…` | **A×3, B×1**. T1's A×1 was **replaced**, not added to (would be 4). B is sold out but **was accepted**. |
| T3 | `GET /cart/add?id=A&quantity=1` | 302 → `/cart` | A×4, B×1. This one **appends**. |
| T4 | `/cart/A:1` (no `storefront`) | 302 → `/checkouts/cn/<token>/en-nz?...` | A×1 (replaced again; buyer lands in checkout) |
| T5 | `/cart/B:1?storefront=true` | 302 → `/cart?…` | B×1 (sold-out line only) |
| Browser | `/cart/B:1,A:1?storefront=true` | cart page | Both lines shown with prices, **no sold-out warning**, subtotal $2.96 including the unavailable line |
| Ajax | `POST /cart/add.js {"items":[{id:B,qty:1},{id:A,qty:3}]}` | 422 "The product '… Lightly Played' is already sold out." | **Empty**. The whole request was rejected, not only the bad line. |

Conclusions:
- **Permalink = replace the cart.** The help pages don't say this; it was observed. The button
  should warn the buyer: "This replaces anything already in your <Store> cart".
- **The permalink doesn't validate stock at the cart step.** Shopify checks availability at
  checkout, but that wasn't tested because checkout is out of scope. So stale cache data can
  produce a cart that looks complete but isn't. Pre-checking is mandatory (§5).
- `GET /cart/add?id=&quantity=` appends one variant per request. A page can't chain several
  requests on another site's cookies without running script on that site, so it's not usable
  for multi-line pre-fill from MagicFinder.
- `/cart/add.js` with an `items[]` array is all-or-nothing on a sold-out line. It's also
  same-origin script only, so it's irrelevant to a link. It is documented in the
  [Ajax Cart API reference](https://shopify.dev/docs/api/ajax/reference/cart), which also notes
  that a quantity above stock is reduced to "the maximum available quantity".
- robots.txt on Shopify Stores disallows `/cart/` and `/cart.js` for crawlers.
  `/products/*.js` isn't disallowed. The cart link is followed by the buyer, not by a crawler,
  so this is fine. MagicFinder itself should never request `/cart/...`; only the pre-check reads
  `/products/<handle>.js`.

### BigCommerce: Vagabond

The [add-to-cart URL docs](https://docs.bigcommerce.com/developer/docs/admin/checkout-and-cart/custom-checkouts/add-to-cart-ur-ls)
describe `/cart.php?action=add&product_id=<id>&qty=<n>` or `&sku=<sku>`. `action=buy` goes
straight to checkout.

The docs say "only one product can be added for each request". `sku` and `product_id` "accept a
single value", so several items need chained requests run from script on the Store's own site.

**A single-line Plan for Vagabond can use a link. A multi-line Plan can't.** That's one Store,
not worth special-casing at first. Treat it as fallback.

### Ecwid: Games Lab

The [Ecwid storefront JS API](https://docs.ecwid.com/storefronts/manage-cart-and-checkout/add-product-to-the-cart)
offers `Ecwid.Cart.addProduct({id, quantity, options})`, which runs inside the store page. No
documented URL fills the cart. **Fallback.**

### Wix: Magic Red Dragon

Wix Stores documents an on-page "Add to Cart" button and Velo code
([multiple items tutorial](https://dev.wix.com/docs/develop-websites/articles/code-tutorials/wix-e-commerce-stores/adding-multiple-items-to-the-cart-in-a-wix-stores-site.md)).
There is no URL parameter. A third-party "Checkout Links" app exists, but the Store would have
to install it. **Fallback.** MtgSingles Listing urls look like `/product-page/<slug>`, and the
condition is "N/A".

### WooCommerce

None of the surveyed NZ Stores run it. For reference, core WooCommerce `?add-to-cart=<id>` adds
one product per link; several products need a plugin. Not needed.

### Hobby Master: custom

- The Listing url is `https://hobbymaster.co.nz/cards/card/<id>`. The id is the Store's own
  card+condition stock id, and each condition/foil combination has its own id.
- Add to cart is an AJAX `POST /cards/add-to-cart` with `{id, quantity, sell:0}` (`display.js`,
  `checkAddToCart`). It runs same-origin with the PHP session cookie. It can't be triggered from
  a link without cross-site POST tricks, which **should not be done**. The cart has a 120
  unique-item cap (`MAX_CART_NUMBER = 120`).
- `https://hobbymaster.co.nz/deck-builder` has a POST textarea for a pasted list ("4 Selfless
  Spirit" per line). It shows the Store's stock per card, and the buyer then adds items. It can't
  be pre-filled by URL either.
- Fallback: **copy "qty name" lines to the clipboard and open `/deck-builder`**, or open each
  Listing.

### Bay Dragon: custom

The Listing url is `/category/01/brand/01/single/<itemCode>/<stockId>`. Add to cart is a POST
form (`/category/01/buyStockSingles;jsessionid=…`) with about 20 hidden fields per item
(`qty_<stockId>`, …), tied to a Java session. **Fallback: open each Listing.**

## 4. Getting Shopify variant ids from the data we already read

MtgSingles Listing `url`s from the Lightning Bolt sample:

| Store | url shape | variant id in url? |
|---|---|---|
| TCG Collector NZ | `/products/lightning-bolt-fdc-163-commander-foundations?utm_…` | No |
| Goblin Games | `/products/lightning-bolt-double-masters-2022?utm_…` | No |
| Shuffle and Cut | `/products/lightning-bolt-marvel-super-heroes-commander?utm_…` | No |
| MTG Magpie, Iron Knight Gaming | `/products/<handle>?utm_…` | No |
| Otaku Mart | `/products/<handle>?variant=39631556149309&utm_…` | **Yes** (one url per condition) |

So **look up variants with `GET https://<store>/products/<handle>.js`**. It is public, needs no
auth, and is the same endpoint #3 already used for spot checks. It returns `variants[]` with
`id`, `title`, `price` (cents), `available` and `sku`. Observed:

- **TCG Collector NZ (BinderPOS)**: option `Condition`. Variants are "Near Mint", "Lightly
  Played", "Moderately Played", "Heavily Played", "Damaged". SKU `MTG-FDC-163-<hash>-1..5`. Foil
  is presumably a separate product: the handle has no foil suffix and there are no foil variants.
- **Shuffle and Cut**: option `Title`. Ten variants: the five conditions, then the same five with
  " Foil" appended. SKU `MSC-806-EN-NF-1` … `MSC-806-EN-FO-5`. NF = non-foil, FO = foil, last
  digit = condition rank.
- **Goblin Games**: "NM-Mint", "Lightly Played", …, "Damage". SKU `2X2-117-EN-NF-1..5`.
- **Otaku Mart**: "Near Mint" … "Damaged". SKU `ASTX-76-EN-NF-1..5`.

Mapping rule (MtgSingles Listing → variant):

1. Use `?variant=` if the url has it. Still check that it's `available`.
2. Otherwise fetch `<url without query>.js`.
3. Choose variants whose **condition** matches:

   | MtgSingles `condition` | Store variant |
   |---|---|
   | `NM / SP` | Near Mint / NM-Mint / SKU rank 1 |
   | `SP / LP` | Lightly Played / rank 2 |
   | `MP` | Moderately Played / rank 3 |
   | `HP` | Heavily Played / rank 4 |
   | `D` | Damaged / Damage / rank 5 |
   | `N/A` | the only available variant |

   (Seen in the data: the Otaku Mart `SP / LP` Listing linked the "Lightly Played" variant.)
4. Choose by **finish**:
   - If `features` contains `Foil`, prefer titles ending " Foil" or SKUs with `-FO-`.
   - Otherwise prefer non-foil titles or `-NF-` SKUs.
   - **#3 found MtgSingles missing the Foil flag** (Shuffle and Cut). So if the
     finish-matched variant is unavailable or the price doesn't match, fall back to the variant
     whose **price equals the Listing price** and which is `available`.
5. Price check: the variant price in cents must equal `Listing.price × 100`. If the variant is
   unavailable, or no variant matches, mark the line **"Couldn't confirm. Open the Listing"**
   and leave it out of the permalink.

Request cost: one `.js` per Listing for that Store, run only when the buyer clicks the button.
A Plan with 15 lines at one Store = 15 requests at ~1/s. Results can be cached briefly. This is
also the stock and price **re-check** (§5), so it does double duty.

Integrated Stores (MtgSingles' Shopify app, #3) may use `?variant=` links more often. The data
could also come from somewhere else in future: if MagicFinder ever reads Shopify Stores
directly, the variant id is already known.

## 5. Pitfalls and fallback

**Pitfalls**

- **Stale cache (~1 h).** Between the search and the click, a single can sell. A permalink would
  silently add the sold-out line, and the cart page would show it with a price and no warning.
  The buyer only learns at checkout.
  → Re-check with `products/<handle>.js` on click, and leave unavailable lines out.
- **Price changed.** The variant price differs from the Plan.
  → Still add it, but show "price now $X (was $Y)" before opening, and update the Store's total.
- **Quantity.** `.js` exposes `available` but not stock count (`inventory_quantity` was null on
  every Store sampled). A Plan line with qty 3 may only have 1 left. The permalink would accept
  3 anyway, and checkout reduces it or errors.
  → Use the Listing's `availableQty` as a cap, and warn when qty > 1.
- **Cart replaced.** The buyer's existing cart at that Store is wiped.
  → Show a confirmation text on the button.
- **Partial adds.**
  - The permalink accepts every line it can parse.
  - A *deleted* variant id → per the Ajax API docs, an unknown variant gives 404 "Cannot find
    variant". Permalink behaviour for deleted variants wasn't tested.
  - Always tell the buyer which lines were left out and why.
- **Password-protected or paused stores** (Card Baron, XP Games, Card Slayer). The permalink
  won't work.
  → Detect a redirect to `/password` or an HTTP 402 during the pre-check and fall back.
- **Marketplace vs Store.** Fetch Listings from several Stores share one cart, so "Add all to
  cart" per Fetch Store would be misleading. Use one Fetch button for all Fetch Stores in the
  Plan, which opens the Listings.
- **Listing url drift.** MtgSingles urls can point to a product whose handle changed (404 on
  `.js`).
  → Treat as "couldn't confirm" and open the Listing url.
- **Don't land buyers in checkout.** Always use `storefront=true`.

**Fallback** (non-Shopify Stores, Fetch, and any line that fails the pre-check)

1. "Open Listings": open each Listing url in a new tab. Browsers may block more than one popup
   per click, so render a list with a single "open all" that opens tabs from one user gesture,
   or one link per line.
2. For Hobby Master, "Copy list & open Deck Builder": copy `qty name` lines and open
   `/deck-builder`.
3. Always show the list (card, Printing, condition, qty, expected price) beside the button, so
   the buyer can tick off items while adding them by hand.

## 6. Recommendation

The button differs by Store platform, recorded in the Store table (#7's `data/stores.yaml`).
Add `cart: shopify | fetch | open-listings | hobbymaster-deckbuilder`, seeded from §2.

- **Shopify Stores (~40):** a real **"Add all to cart"**. On click:
  1. For each line, resolve the variant id (`?variant=` or `products/<handle>.js`) and check
     `available` and price. Do this server-side in MagicFinder, at about 1 request/s per Store.
  2. Show a short pre-flight summary: "12 of 13 cards still available. Lightning Bolt (LP) sold
     out. 1 price changed. This replaces your current <Store> cart."
  3. Open `https://<store>/cart/<v1>:<q1>,<v2>:<q2>,…?storefront=true`.
     - Optionally add `&ref=magicfinder`, but only if Stores are fine with it.
     - Never add `checkout[...]`, and never use the no-`storefront` checkout form.
  4. List the excluded lines with links to their Listings.
- **Fetch TCG:** one **"Open N Fetch Listings"** for all Fetch Stores in the Plan, plus the
  one-cart note. No cart API, no session, no automation.
- **Hobby Master:** **"Copy list & open Deck Builder"**, with "Open Listings" as a secondary
  button.
- **Bay Dragon, Magic Red Dragon, Vagabond, Games Lab, Hobby Lords, and any Store whose
  pre-check fails:** **"Open Listings"**.

Build order:
1. Shopify permalink plus pre-check (most of the value).
2. Open-Listings fallback (needed anyway).
3. Hobby Master clipboard.

## 7. Open risks

- **Replace-not-append is observed behaviour, not documented.** Shopify could change it, either
  way. Re-test when implementing.
- **Checkout behaviour with stale lines is untested** (out of scope). The assumption is that
  Shopify flags or removes unavailable lines at checkout. Don't rely on it; pre-check instead.
- **Variant mapping is heuristic.** Title/SKU conventions differ by Store and POS (BinderPOS vs
  others). MtgSingles' Foil flag is unreliable (#3), and non-English and etched-foil products
  may use other suffixes. The price-match fallback mitigates this. Wrong-variant risk remains
  for Stores that price NM foil and NM non-foil the same.
- **Per-click request burst.** A big Plan at one Store means N `.js` requests. Space them out
  (~1/s), cap concurrency, and back off on 429.
- **Stores' own terms** for automated reads of `products/*.js` weren't reviewed per Store. Same
  stance as #3: low volume, user-triggered, identifying User-Agent.
- **Fetch may add a guest cart or deep link.** The guest-cart code is already in the bundle. If
  Fetch grants permission (#2), ask about a cart deep link.
- **Store list drift.** Shopify stores go password-protected or paused (3 of 44 today), and
  domains change (Card Spot → `cardspot.store`, Valkyrie → `valkyriegames.co.nz`). Re-run the
  fingerprint in the monthly Store-table check (#7).
- Card Merchant Silverdale (301) and Hobby Lords (Cloudflare challenge) weren't classified.

## Sources

- Shopify Help Center, "Cart permalinks": https://help.shopify.com/en/manual/products/details/cart-permalink
- shopify.dev, "Create cart permalinks": https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks
- shopify.dev, Ajax Cart API reference: https://shopify.dev/docs/api/ajax/reference/cart
- BigCommerce, "Add to cart URLs": https://docs.bigcommerce.com/developer/docs/admin/checkout-and-cart/custom-checkouts/add-to-cart-ur-ls
- Ecwid storefront JS API (`Cart.addProduct`), via https://docs.ecwid.com/llms-full.txt → https://docs.ecwid.com/storefronts/manage-cart-and-checkout/add-product-to-the-cart
- Wix Velo tutorial, adding multiple items to the cart: https://dev.wix.com/docs/develop-websites/articles/code-tutorials/wix-e-commerce-stores/adding-multiple-items-to-the-cart-in-a-wix-stores-site.md
- Fetch TCG: `https://www.fetchtcg.com/cart` (signed out); JS chunks `9626-e0cce6733e818450.js`,
  `4737-45db279596da803d.js`, `cart/page-d9d2bf065bddc9a7.js`; Terms https://www.fetchtcg.com/policies/terms §7
- Hobby Master: `https://hobbymaster.co.nz/cards/card/1136915`, `/asset/js/display.js?v=62`
  (`addToCart`, `checkAddToCart`, `MAX_CART_NUMBER`), `/deck-builder`
- Bay Dragon: `https://baydragon.co.nz/category/01/brand/01/single/01010100270/47376` (form `buyStockSingles`)
- Store homepages (fingerprints) for every domain in §2; `https://cardmerchant<branch>.co.nz/meta.json`
- Shopify product JSON: `tcgcollectornz.com`, `shuffleandcutgames.co.nz`, `goblingames.nz`,
  `otakumart.co.nz` `/products/<handle>.js`
- Permalink tests: `https://tcgcollectornz.com/cart/...` (anonymous carts, cleared); `https://tcgcollectornz.com/robots.txt`
- MtgSingles API (from the MtgSingles page in a browser): `api.mtgsingles.co.nz/MtgSingle?query=Lightning%20Bolt&…&includeMarketplaces=false`
