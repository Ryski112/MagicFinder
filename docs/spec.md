# MagicFinder build spec

MagicFinder finds the cheapest way for a buyer in New Zealand to buy a list of Magic: The Gathering singles, postage included. It shows how the cost changes with the number of Stores the buyer orders from.

This spec gathers the decisions made on the [Wayfinder map](https://github.com/Ryski112/MagicFinder/issues/1). Each section links the ticket that holds the full reasoning. Terms in **bold capitals** (Want List, Source, Store, Listing, Printing, Locked Printing, Plan, Landed Cost, Trade-off Ladder, Not Found, Source Status) are defined in [`CONTEXT.md`](../CONTEXT.md). Use them in code and UI copy.

## 1. Scope

**In scope**
- A locally run app on each user's own computer. It's started with one command and opens in the browser. Friends with some coding knowledge can install it.
- Two Sources: Fetch TCG and MtgSingles. The data layer takes more Sources later as plug-ins.
- NZ-based Stores only.
- Want List import by paste (Archidekt, Moxfield, Arena/MTGO, plain text) and by Archidekt deck URL.
- Live search per run with about a 1 h cache, then a Trade-off Ladder of Plans and a per-Store breakdown with clean links.
- A per-Store button that opens the Store with the Plan's cards in the cart (where the Store supports it). The buyer checks out themselves.

**Out of scope**
- Sources beyond Fetch TCG and MtgSingles (design for them, don't build them). This includes reading Stores' own Shopify shops as a Source.
- Australian Stores.
- A public hosted site.
- Docker/NAS and shared multi-user installs.
- Automating checkout or placing orders.
- An Electron desktop app or installer. That's wanted later, so keep the stack Electron-friendly.
- Store trust signals such as ratings.

## 2. Architecture

Decided in [Tech stack and how people install and run it](https://github.com/Ryski112/MagicFinder/issues/10).

| Part | Choice |
|---|---|
| Runtime | Node.js LTS ≥ 22.13 (built-in `node:sqlite`), one TypeScript project |
| Front end | React + Vite, Tailwind + shadcn/ui |
| Back end | Hono server. It makes every Source, Archidekt and Scryfall call (they can't be made from the browser because of CORS and Cloudflare) and serves the built front end |
| Storage | `node:sqlite` for the search cache and the Scryfall index. Settings in a JSON file in the user's data directory. The Store table in `data/stores.yaml` (checked in) |
| Optimiser | HiGHS WASM (`highs` npm, MIT) in worker threads |
| Live updates | The server streams progress and Ladder updates to the UI (e.g. SSE) |
| Tests | Vitest against recorded fixture responses. Tests never call live Sources |

Keep the server and UI separable so an Electron shell can wrap them later without a rewrite.

**Source plug-in interface**: each Source is a module that takes a card name and returns Listings plus a Source Status. Sources are registered in one place, and each can be switched on or off in Settings.

## 3. Reference data

### 3.1 Card catalogue and identity

Decided in [How do we identify a card and Printing consistently across Sources?](https://github.com/Ryski112/MagicFinder/issues/5).

- Download Scryfall's `default_cards` bulk file once a day, stream it into SQLite, and match against that local copy. Never make one Scryfall API call per Listing.
- **Card key** = `oracle_id`. **Printing key** = (Scryfall `id`, finish), where finish is nonfoil, foil or etched.
- Treatment labels (showcase, borderless, extended art…) come from Scryfall's `frame_effects`, `border_color`, `full_art`, `frame` and `promo_types`.
- **Matching a Listing:**
  1. Use a structured id if the Source has one (Fetch gives a Scryfall id).
  2. Otherwise strip set, collector number, finish, treatment and condition words from the title.
  3. Normalise the name and look it up in an index of full names, face names and flavour names.
  4. Narrow to a Printing using the remaining hints.
- **Match confidence** is `exact`, `card-only` or `unmatched`. Never guess a Printing.
- **Name collisions**: keep the small list of normalised names that collide (e.g. `Bind` / `Bind // Liberate`) and require an exact match for those.
- **Attribution**:
  - Show full, unaltered Scryfall card images, and credit the artist if `art_crop` is used.
  - Don't re-serve Scryfall data as a dataset.
  - Footer: the WotC Fan Content Policy notice, plus "Card images © Wizards of the Coast, via Scryfall".

### 3.2 Store table

Decided in [Where do each Store's postage costs and location come from?](https://github.com/Ryski112/MagicFinder/issues/7) and [Can each Store's cart be pre-filled from a Plan?](https://github.com/Ryski112/MagicFinder/issues/15).

`data/stores.yaml` has one row per Store, keyed by its Source keys (Fetch seller id, MtgSingles `NZ/<Key>`). Each row holds:

- `location`: city and region. Filled automatically where possible (Fetch `regionAddress`, Shopify `/meta.json`).
- `pickup`: `{ available, fee }`.
- `postage`: options `{ price, tracked, rural_surcharge, region_prices }`.
- `free_postage`: `{ threshold, applies_to }`.
- `cart`: one of `shopify | fetch | open-listings | hobbymaster-deckbuilder`, plus the Store's site domain.
- `provenance`: `{ url, checked_on, confidence }`.

Notes:
- Stores that don't publish postage use an editable default of $7 tracked (+$5 rural) and are shown as "est.".
- The buyer can override postage per Store in Settings.
- A monthly change-detection job hashes each Store's policy page and `meta.json`, and opens an issue for a human to update the table when something changes.

## 4. Want List input

Decided in [What Want List formats must import support, and what does Archidekt give us?](https://github.com/Ryski112/MagicFinder/issues/4) and [Which Listings count as a match for a Want List line?](https://github.com/Ryski112/MagicFinder/issues/8).

**Paste parser**
- One forgiving line parser: `qty[x] name [(SET) [cn]] [*F*|*E*] [[categories]]`.
- Section headers: Commander, Deck/Mainboard, Sideboard, Companion, Maybeboard.
- It covers Archidekt, Moxfield, Arena/MTGO and plain text.
- Split and double-faced cards match on the front face.

**Archidekt URL**: the back end fetches `GET https://archidekt.com/api/decks/{id}/`. Moxfield URLs are Cloudflare-blocked, so Moxfield users paste instead. Don't use Archidekt's CSV export.

**Line shape**: `{ quantity, name, set?, collectorNumber?, finish?, section }`. Set, collector number and finish are **hints** only.

**Which lines are included**
- **Sections**: mainboard, commander(s) and sideboard are included. Maybeboard and Archidekt's "Considering" are excluded.
- Every line has an include/exclude checkbox.
- **Basic lands** (including Snow-Covered and Wastes) are skipped by default and listed as "Skipped: basic lands (N)", with a toggle to include them.
- **Duplicate lines** are merged by `oracle_id`, with quantities summed, when neither is locked or both are locked to the same Printing.
- **Unrecognised lines** are listed as "Couldn't recognise: …".

**Import hints**
- Hints are ignored by default. Each hinted line shows "your list said …" with a one-click lock.
- The global setting **Use the Printings from my list** (default off) locks every hinted line.

## 5. Sources

Researched in [How can Fetch TCG listings be searched and read?](https://github.com/Ryski112/MagicFinder/issues/2) and [How can MtgSingles listings be searched and read?](https://github.com/Ryski112/MagicFinder/issues/3).

The owner decided not to ask the Sources for permission ([Ask MtgSingles for permission / API access](https://github.com/Ryski112/MagicFinder/issues/11), [Ask Fetch TCG for permission / postage data](https://github.com/Ryski112/MagicFinder/issues/12)). MagicFinder reads public Listings politely, at low volume, for personal and friends' use. Don't route Source traffic through a VPN.

### 5.1 Fetch TCG
- Plain HTTP: `GET https://api.fetchtcg.com/v1/market/listings?cardName=<name>&gameIds=mtg&countryCode=NZ&currencyCode=NZD&size=200&page=0`. Always pass `countryCode`.
- Requests are serial, about 1 s apart, with an identifying User-Agent. Never call `/view` counter endpoints.
- Matching: by Scryfall id (`externalReferences.scryfallId`). Name search is fuzzy.
- Language: there's no language field. A non-English name suffix such as "(Japanese)" means the Listing is dropped.
- **Store** = the individual seller (`listedByUserId`, `sellerBusinessName`). Location and pickup come from `regionAddress`.

### 5.2 MtgSingles
- Plain HTTP: `GET https://api.mtgsingles.co.nz/MtgSingle?query=<name>&tcgType=1&includeMarketplaces=false&sortOrder=2&page=N&pageSize=20&Country=1`, about 1 request/second, with the identifying User-Agent. Cloudflare refuses (403) any request without `Referer: https://www.mtgsingles.co.nz/`; the User-Agent doesn't matter. No browser is needed.
- Paging: 20 results per page. Keep paging until fewer than 20 come back. A card with no Listings comes back as `204 No Content` with an empty body.
- Don't use exact match. Normalise names ourselves, because double-faced card titles differ.
- `includeMarketplaces=false`: Fetch sellers are handled by the Fetch Source.
- There's no collector number or Store location. Location comes from the Store table. `features[]` gives treatment and `Non-English`. Prices are strings such as `"$1,345.99"`.
- There's no stealth and no challenge-solving.

### 5.3 Source Status and blocking

Decided in [What happens when a Source blocks MagicFinder?](https://github.com/Ryski112/MagicFinder/issues/14).

**Source Status** values, shown in plain words:

| Status | Trigger | Behaviour |
|---|---|---|
| OK | Normal answers | — |
| Blocked | Cloudflare / "checking your browser" page, or 403 | Stop that Source for this run at once, with no retries. No automatic retry for 30 min, plus a **Try again now** button |
| Slowed down | 429 | Wait as asked (Retry-After), up to 3 attempts, then treat it as Blocked for this run |
| Down | 5xx, timeout, network error | 2 retries a few seconds apart, then skip that card on that Source (it's searched on the others only). Server errors on 3 cards in a row mean the Source is down for this run |
| Changed | Response is missing the fields we rely on | "MagicFinder may need an update", plus **Copy details** (Source, status, what was wrong, app version, time; no personal data) |

**Detection** (no extra requests on a normal run)
1. **Shape check** on every response.
2. **Suspicion**: a Source that returns nothing for 80%+ of the Want List (at least 10 cards) while the other Source finds many of those cards.
3. **Staples check**, only when suspicious: ask for a basket of everyday cards. The default basket is Lightning Bolt, Counterspell, Swords to Plowshares, Llanowar Elves and Sol Ring, kept in an editable settings file. If none come back, the Source is silently Blocked and its cards count as "not searched".

**Partial data**
- The run continues with the working Source(s). Listings received before a block are kept.
- A banner names the cards searched on one Source only and says the Ladder may not be the cheapest.
- A card that's still missing is excluded and reported as "Not Found on Fetch TCG (MtgSingles not searched)".
- If every Source fails, there's no Ladder, just an explanation.

**Stale cache**: while a Source is Blocked or Down, cached Listings up to 24 h old are used, and each affected Store section is labelled with their age.

**Repeated blocks**: after 3 consecutive blocked runs, Settings shows "<Source> has blocked the last 3 runs" with a one-click **Turn off <Source>**. A Source is never disabled automatically.

**No workarounds**: never switch a Source's access method after a block (e.g. Fetch to a browser), and never solve or evade bot checks.

### 5.4 Cache
- Search results are cached in SQLite per (Source, card name) for about 1 h, so locks, pickup toggles and settings changes re-optimise without searching again.
- "Search again" bypasses the cache.

## 6. Which Listings are eligible

Decided in [Which Listings count as a match for a Want List line?](https://github.com/Ryski112/MagicFinder/issues/8). These filters run before the optimiser.

**Listing filters**
- **Condition**: the minimum is Lightly Played or better (a setting). MtgSingles combined grades count as their worse half (`SP / LP` → LP). `N/A` passes and is tagged "condition not stated".
- **Language**: English only, with no setting.
- **Buyability (Fetch)**: offer-only (`buyNowEnabled=false`) and `sellerOnHoliday` Listings are never used.

**Unlocked lines**
- Any English Printing in any finish is eligible, and lines may mix Printings.
- Gold-bordered, oversized, art-series and similar non-tournament cards are excluded, but still shown as alternatives.
- Setting **Allow foils** (default on): when off, foil and etched Listings are dropped from unlocked lines.

**Locked lines**
- A lock is an exact Printing (Scryfall `id` + finish), and only that Printing can fill the line.
- If the locked Printing has no Listing, the line is Not Found, with a nudge to unlock.

**Uncertain matches**
- `card-only` matches count for unlocked lines and are tagged "Printing not confirmed". They're excluded from locked lines.
- A title that suggests foil counts as foil for the Allow foils setting.
- `unmatched` Listings are dropped and counted ("12 Listings couldn't be identified").

## 7. Optimiser and the Trade-off Ladder

Decided in [What optimiser approach produces the Trade-off Ladder?](https://github.com/Ryski112/MagicFinder/issues/6) and [What does each rung of the Trade-off Ladder mean?](https://github.com/Ryski112/MagicFinder/issues/13). The full MILP model is in the [optimiser research](https://github.com/Ryski112/MagicFinder/blob/research/optimiser/docs/research/optimiser.md).

**Model**
- An exact MILP per rung, with constraint Σ y_s ≤ k.
- Quantities may be split across Listings and Stores.
- Postage is a step function of each Store's subtotal: a binary per tier or free threshold, with a lower bound on subtotal.
- Pickup Stores have zero postage but still count toward k.
- Locks are handled by filtering Listings, and dominated Listings are pruned.
- A small cover MILP finds k_min, the fewest Stores that cover every obtainable card.

**Draft and refinement**
- A greedy drop plus 1-swap heuristic gives a draft Ladder in under 1 s after the Listings arrive, marked "refining".
- Exact solves then run in parallel worker threads, with a 10 s limit per rung and a 0.5% MIP gap. They replace the draft rungs as they finish, aiming for the final Ladder in about 30 s for a 100-card deck.
- **Cheapest overall** settles first. Prices only go down while refining, and rungs may appear or disappear. Once final, nothing changes.

**Rungs**
- Rung k is the cheapest Plan using exactly k Stores.
- Rungs are shown from k_min up to the Store count of the cheapest Plan overall, and the top rung is labelled **Cheapest overall**.
- A rung that saves nothing over the one below it is hidden.
- There's no cap; each rung shows "saves $X vs one fewer Store".
- Below k_min: **Short Plans** for 1, 2 and 3 Stores (owner's change, 2026-10-17, reversing "no partial Plans"). Each leaves out the fewest copies, then is the cheapest Plan that does so. It is solved in two steps: the most copies k Stores can supply, then the cheapest way to buy that many. Short Plans come first in the Ladder, show "N of M cards", and list the cards they leave out (collapsible, with images). The status line still says "Fewest Stores that cover your list: N".

**Timeouts**
- A rung that hits its time limit shows the best Plan found, with "might be up to $X cheaper" (from the solver bound).
- If no Plan was found in time, the rung shows "Couldn't find a k-Store Plan in time" with **Try longer**. Rungs are never dropped silently.

**Reruns**: locking or unlocking a Printing, toggling pickup, or changing a setting reruns the same draft-then-refine process on the cached Listings.

## 8. Postage and pickup

From [Where do each Store's postage costs and location come from?](https://github.com/Ryski112/MagicFinder/issues/7) and [What does each rung of the Trade-off Ladder mean?](https://github.com/Ryski112/MagicFinder/issues/13).

**Postage**
- **Postage type** is a setting, with tracked as the default.
- A Store's postage comes from the Store table (or the buyer's override). Free-postage thresholds apply to the Store's subtotal.
- Landed Cost = card prices + each Store's postage.

**Pickup**
- **Pickup city** is a setting (owner: Auckland).
- Stores in that city that offer pickup get a per-Store **I'll pick up** toggle. It's off by default (pickup is never assumed) and remembered between runs. When on, postage is zero, plus the Store's pickup fee if any.
- When a rung's Plan uses a pickup-eligible Store that's still costed with postage, it shows "Pickup available at X, saves $Y".

## 9. GUI

Decided in [What should the results GUI look like?](https://github.com/Ryski112/MagicFinder/issues/9). The visual reference is **variant D** of the [prototype](https://github.com/Ryski112/MagicFinder/blob/prototype/results-gui/prototypes/results-gui/index.html), on branch `prototype/results-gui`. Rewrite it properly; don't copy prototype code.

**Shell**
- A header with a three-step stepper (**Want List → Search → Choose a Plan**), a ☀/🌙 theme toggle and ⚙ Settings, which opens a slide-out drawer.
- **Dark mode** is the default, and the choice is remembered.

**1. Want List**
- A simple start screen: a headline, an Archidekt URL box with **Import**, a large paste box, and one primary **Find my cards** button.
- Beside the button, a one-line summary ("14 cards recognised, 1 not, basics skipped").
- **Review list** expands the parsed lines: include checkboxes, "your list said … · lock" hints, unrecognised lines and skipped basics.

**2. Search**
- A progress card ("Searching 7/14: Rhystic Study…") with each Source's status, including Blocked and other warnings.
- Below it, the Want List's card images fade in as each card is searched.

**3. Choose a Plan**
- **Top bar**: "← Edit Want List", refining/final status, and "Fewest Stores that cover your list: N".
- **Notices**: Not Found, couldn't recognise, skipped basics, unidentified Listings, Source Status warnings and stale-cache age.
- **Ladder**: a row of rung cards ("N Stores · $X · saves $Y vs N−1"), with refining, timed-out and Try-longer badges. **Cheapest overall** is selected by default.
- **Plan**: one section per Store.
  - **Header**: the Store name (links to the Store), city, Source badge, the pickup toggle where eligible, and the Store's cart button (§9.1).
  - **Each line**: a small card image that enlarges on hover, qty, name, 🔒 if locked, a condition tag, a "Printing not confirmed" tag, the Printing label, the price, and **View listing ↗**.
  - **Side column**: cards subtotal, postage ("Free", "Pickup" or "est."), a "free postage over $X ($Y away)" nudge, and the Store total.
- **Below the Plan**: a pickup hint and the Plan's **Landed Cost**.
- **Other Printings** expands inline under a line as a grid of card images, each with "from $X · N Stores" and **Lock this one**.
  - Locking collapses the grid back to the small image, and the Ladder reruns.
  - Locked Printings can be unlocked from the same grid.

### 9.1 Store cart buttons

Each Store section's cart button depends on the Store table's `cart` field:

| `cart` | Button | Behaviour |
|---|---|---|
| `shopify` | **Add all to cart** | See the steps below |
| `fetch` | **Open N Fetch Listings** (one button covering all Fetch Stores in the Plan) | Opens each `/marketplace/listings/{id}`, with a note that Fetch has one cart for every seller. Flags offer-only Listings. MagicFinder never touches the Fetch cart |
| `hobbymaster-deckbuilder` | **Copy list & open Deck Builder** | Copies the Store's lines as text and opens its `/deck-builder` |
| `open-listings` | **Open Listings** | Opens each Listing page from one click, with the line list shown alongside |

**Shopify flow:**
1. Resolve each line's variant: `?variant=` on the Listing URL, or one `products/<handle>.js` call (about 1 req/s), matching on condition and foil, with price as the tiebreaker.
2. Re-check `available` and price.
3. Show a pre-flight summary, e.g. "12/13 available, 1 price changed, replaces your current cart at this Store".
4. Open `/cart/<variant>:<qty>,…?storefront=true`.
5. List any dropped lines with their Listing links.

MagicFinder never reads `/cart` itself, never pre-fills email or address, and never goes past the Store's cart page. Details are in the [cart research](https://github.com/Ryski112/MagicFinder/blob/research/store-cart-prefill/docs/research/store-cart-prefill.md).

## 10. Settings

All settings live in the user's settings file and are editable in the Settings drawer unless noted otherwise.

| Setting | Default |
|---|---|
| Postage type | Tracked |
| Pickup city | Auckland |
| Per-Store pickup toggles | Off; remembered |
| Per-Store postage overrides | None |
| Minimum condition | Lightly Played |
| Allow foils | On |
| Use the Printings from my list | Off |
| Include basic lands | Off |
| Search Fetch TCG / Search MtgSingles | On / On |
| Theme | Dark |
| Staples basket (file only) | Lightning Bolt, Counterspell, Swords to Plowshares, Llanowar Elves, Sol Ring |

## 11. Install, run and licence

- **Install**: the README steps are install Node, clone, `npm install`, `npm start`. `start.sh` / `start.bat` one-click scripts install on first run and then start the app.
- **Running**: `npm start` runs the server and opens the browser. It runs on the user's own workstation (the owner's is Linux).
- **Repo**: private for now, with collaborators invited. Make it public under **MIT** once the app works.
- **Clean-room**: MTGBulkSingles (AGPL-3.0) is a reference only; copy no code.

## 12. Defaults chosen while writing this spec

These details weren't settled on a ticket. They follow from the decisions above, and the owner confirmed them on 2026-10-17.

- **Rural delivery**: a "Rural address" setting (default off) adds each Store's rural surcharge.
- **Region pricing**: Stores that price by Auckland / North Island / South Island use the region of the buyer's pickup city.
- **Postage tiers**: modelled by Store subtotal only (flat rate plus free-postage thresholds). The survey found no card-count or weight tiers.

## 13. Known risks

- **Undocumented APIs**: both Sources and Archidekt can change or close without notice. The Changed status and fixture tests are the mitigation.
- **Source terms**: Fetch's Terms forbid automated access without permission, and MtgSingles' Cloudflare block signals it doesn't want non-browser clients. The owner accepted this for low-volume personal use.
- **Store table accuracy**: postage and pickup data is hand-maintained and drifts. The mitigations are monthly change detection and "est." labels.
- **Shopify cart links**: replacing rather than adding to the cart was observed, not documented, and variant matching is heuristic. The mandatory pre-check covers stock and price.
- **Solve times**: these vary with the Want List. Time limits and honest badges keep the UI responsive.

## Decision index

- [How can Fetch TCG listings be searched and read?](https://github.com/Ryski112/MagicFinder/issues/2)
- [How can MtgSingles listings be searched and read?](https://github.com/Ryski112/MagicFinder/issues/3)
- [What Want List formats must import support, and what does Archidekt give us?](https://github.com/Ryski112/MagicFinder/issues/4)
- [How do we identify a card and Printing consistently across Sources?](https://github.com/Ryski112/MagicFinder/issues/5)
- [What optimiser approach produces the Trade-off Ladder?](https://github.com/Ryski112/MagicFinder/issues/6)
- [Where do each Store's postage costs and location come from?](https://github.com/Ryski112/MagicFinder/issues/7)
- [Which Listings count as a match for a Want List line?](https://github.com/Ryski112/MagicFinder/issues/8)
- [What should the results GUI look like?](https://github.com/Ryski112/MagicFinder/issues/9)
- [Tech stack and how people install and run it](https://github.com/Ryski112/MagicFinder/issues/10)
- [Ask MtgSingles for permission / API access](https://github.com/Ryski112/MagicFinder/issues/11) and [Ask Fetch TCG for permission / postage data](https://github.com/Ryski112/MagicFinder/issues/12)
- [What does each rung of the Trade-off Ladder mean?](https://github.com/Ryski112/MagicFinder/issues/13)
- [What happens when a Source blocks MagicFinder?](https://github.com/Ryski112/MagicFinder/issues/14)
- [Can each Store's cart be pre-filled from a Plan?](https://github.com/Ryski112/MagicFinder/issues/15)
