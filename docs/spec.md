# MagicFinder build spec

MagicFinder finds the cheapest way for a buyer in New Zealand to buy a list of Magic: The Gathering singles, postage included. It shows how the cost changes with the number of Stores the buyer orders from.

This spec gathers the decisions made on the [Wayfinder map](https://github.com/Ryski112/MagicFinder/issues/1). Each section links the ticket that holds the full reasoning. Terms in **bold capitals** (Want List, Source, Store, Listing, Printing, Locked Printing, Plan, Landed Cost, Trade-off Ladder, Not Found, Source Status) are defined in [`CONTEXT.md`](../CONTEXT.md). Use them in code and UI copy.

## 1. Scope

**In scope**
- A locally run app on each user's own computer. It's started with one command and opens in the browser. Friends with some coding knowledge can install it.
- Two Sources: Fetch TCG and MtgSingles. The data layer takes more Sources later as plug-ins.
- NZ-based Stores, plus an optional "Australian Stores" mode (off by default, MtgSingles AU only): prices are converted from AUD, and Plans combine NZ and AU Stores. Each Australian Store's checkout is checked weekly for postage to NZ (§3.2). "Exclude Australian Stores that don't ship to NZ" (on by default) leaves out the ones that don't. Ones nobody could check stay in, marked "may not ship to NZ". Postage is checkout's rate to Auckland where known, otherwise a buyer-editable guess. The buyer can still exclude any Store by hand (excluded Stores are remembered).
- Want List import by paste (Archidekt, Moxfield, Arena/MTGO, plain text) and by Archidekt deck URL, plus a card searcher that adds cards by name.
- Live search per run with about a 1 h cache, then a Trade-off Ladder of Plans and a per-Store breakdown with clean links.
- A per-Store button that opens the Store with the Plan's cards in the cart (where the Store supports it). The buyer checks out themselves.

**Out of scope**
- Sources beyond Fetch TCG and MtgSingles (design for them, don't build them). This includes reading Stores' own Shopify shops as a Source.
- Australian Stores beyond MtgSingles AU, and Australian Stores' free-postage thresholds.
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
- **Match confidence** is `exact`, `card-only` or `unmatched`. Never guess a Printing. Evidence, in order: a structured id (Fetch's Scryfall id; for MtgSingles, a Scryfall id in the Store picture's address, either Scryfall's own CDN or a Shopify file named after the id); the set, collector number and treatments in the title; a title with no treatment at all taking the set's one plain Printing (Stores label variants and leave the ordinary one bare), only when exactly one plain Printing is left; and finally the picture: Stores on one platform name the picture by a card id ("236019_370x480.jpg"), so a card-only Listing sharing it with an exactly identified one is that Printing, provided it still fits the title's set and number and the picture was not seen on two different Printings. The Store's own picture is kept on each Listing and shown on the Plan screen and in Browse by Store (the Printing's Scryfall image is the fallback), so an unconfirmed Printing can be judged by eye.
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
- Shopify Stores' postage comes from what their checkout actually offers (`npm run probe-postage` puts one cheap single in a throwaway cart and reads `/cart/shipping_rates.json` for an Auckland, Wellington and Christchurch address), because policy pages can disagree with checkout. Those entries have `confidence: checkout`.
- A monthly change-detection job hashes each NZ Store's policy page, `meta.json` and checkout postage, and opens an issue for a human to update the table when something changes.
- **Australian Stores** (#61) are listed at the end of the table with `country: AU` and `ships_to_nz: true | false | null`. Their ids are the ones MagicFinder gave them before they were listed (`mtgsingles:AU/<Key>`), so buyers' exclusions still apply. `npm run probe-au` finds them by searching MtgSingles AU for a few staples. It then puts an in-stock single in a throwaway cart (a fresh cart per address, because a cart keeps the rates of the first address it was asked about) and asks `/cart/shipping_rates.json`:
  - Rates for Auckland: ships, and the cheapest becomes the Store's postage. The cart is put in the NZ market (`?country=NZ`), because Shopify quotes in the visitor's currency (some shops quote NZD from NZ, and GitHub's US runners get USD). An NZD rate is used as it is, an AUD rate is converted at that day's rate, and any other currency leaves the postage unknown.
  - "Country/region not supported": doesn't ship.
  - No rates for Auckland: doesn't ship, but only if a Sydney address does get rates.
  - Anything else: `null`.
  - A site that fails keeps its last result.

  `meta.json`'s `ships_to_countries` isn't used, because checkout disagrees with it (Area52, ManaMarket, TheGamesDistrict and MightyCoolGames list NZ but offer no rate for it). A weekly GitHub Action runs `npm run probe-au -- --write` and commits the table to `main`. In hosted mode the server also runs the check weekly, keeping its results in `au-stores.json` on the data volume (they override the shipped entries and include Stores found since the release). Desktop installs never run it.

### 3.3 CardKingdom comparison

An optional comparison (off by default) prices the Want List at CardKingdom (USA) and flags NZ Listings more than 30% above it ("+X%"), and Listings at least 25% below it as bargains ("−X%", green; only where CardKingdom's price is NZ$5 or more; owner's change, 2026-10-22). A bargain on a Listing below NM, or whose Printing isn't confirmed, says to check both, since it may not be like-for-like. It isn't a Source: nothing is bought there. It only changes a Plan if the buyer switches on "Ignore Listings over 30% above CardKingdom" (off by default), which drops flagged Listings, except where the remaining Listings couldn't cover the copies wanted. It uses two outside services, called only while the comparison is switched on, refreshed once a day, with the identifying User-Agent:

- **CardKingdom's public price list**, `GET https://api.cardkingdom.com/api/v2/pricelist` (about 22 MB), saved to the user's data directory. Matched by Scryfall id. Planning never waits for it; the Plan's view is updated when it arrives.
- **frankfurter.dev** for the USD→NZD rate, `GET https://api.frankfurter.dev/v1/latest?base=USD&symbols=NZD`, saved to the user's data directory, with 1.7 as the fallback.

Totals add a flat shipping estimate and, by default, 15% NZ GST so they compare fairly with NZ prices. When CardKingdom lacks some cards, its total isn't compared with the Plan's. The shipping figure is a flat US$ amount the buyer sets (their own checkout is the best source: a 59-card order to Auckland by Asendia e-PAQ Plus was US$11.50), and GST is charged on cards and shipping together.

**Split** (owner's change, 2026-10-20). "Work out the best split" on the Plan screen adds CardKingdom to the optimiser as one more Store: its prices are converted to NZD with GST, its postage is the shipping figure with GST (paid once, never waived), and it doesn't count toward the Store limit. It solves for the selected rung's Store count and reports the NZ-only Plan, everything-at-CardKingdom, and the split with the cards to buy at CardKingdom. "Take them out of the Plan" unticks those cards so the Plan becomes the NZ part; "Copy the CardKingdom list" copies them as a Want List. When no card repays the shipping it says to stay with the NZ Plan.

## 4. Want List input

Decided in [What Want List formats must import support, and what does Archidekt give us?](https://github.com/Ryski112/MagicFinder/issues/4) and [Which Listings count as a match for a Want List line?](https://github.com/Ryski112/MagicFinder/issues/8).

**Paste parser**
- One forgiving line parser: `qty[x] name [(SET) [cn]] [*F*|*E*] [[categories]]`.
- Section headers: Commander, Deck/Mainboard, Sideboard, Companion, Maybeboard.
- It covers Archidekt, Moxfield, Arena/MTGO and plain text.
- Split and double-faced cards match on the front face.

**Archidekt URL**: the back end fetches `GET https://archidekt.com/api/decks/{id}/`. Moxfield URLs are Cloudflare-blocked, so Moxfield users paste instead. Don't use Archidekt's CSV export.

**Card searcher**: decided in [How should the Want List card searcher look and behave?](https://github.com/Ryski112/MagicFinder/issues/18).
- A search bar between the Archidekt row and the paste box, with a quantity box and **Add**. It searches every name alias in the local catalogue, in memory (`GET /api/cards/search?q=`), and shows 8 suggestions with images.
- Ranking: exact, starts with, every typed word starts a word of the name, contains, then typos (1 edit; 2 for words of 7+ letters; a half-typed last word counts as a prefix). Front faces of double-faced cards and flavour names match too; a flavour match shows "matched …". Ties go to the shorter name (there is no popularity data).
- Keys: ↑/↓ move. **Enter**, **Tab** or a click chooses the card and shows an optional Printing strip (`GET /api/cards/{oracleId}/printings`, newest first, ←/→ with a large preview); Tab also moves on to quantity, then the strip. Enter then adds, with "Any printing (cheapest)" unless one was picked. Escape cancels. The box clears and keeps focus after adding, with a short confirmation.
- A Printing picked here is written as `N Name (SET) num` **and locked** to that Printing (the review list offers "allow any printing"). The same text pasted or imported from Archidekt stays an unlocked hint.
- Adding raises the quantity of a plain main-deck line naming the same card and Printing; otherwise a new line goes at the end of the main deck (before other sections, or before the MTGO blank-line sideboard).
- Disabled until the catalogue is ready, saying so with the download percentage (also as a tooltip).

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
- Plain HTTP: `GET https://api.mtgsingles.co.nz/MtgSingle?query=<name>&isExactMatch=true&tcgType=1&includeMarketplaces=false&sortOrder=2&page=N&pageSize=20&Country=1`, one request every 1.5 seconds (at 1/second Cloudflare starts answering 429 with `Retry-After: 10` after about 30 requests), with the identifying User-Agent. Cloudflare refuses (403) any request without `Referer: https://www.mtgsingles.co.nz/`; the User-Agent doesn't matter. No browser is needed.
- `isExactMatch=true` (the website's "exact match" filter) matches the whole card name. Without it the query matches any title containing the text, so a name inside a set name ("Fracture" in "Reality Fracture") returns hundreds of unrelated Listings and, with paging capped, never reaches the card. A double-faced card is searched twice, by its front face and by its full name, because Stores title it either way. A Listing with an odd title (e.g. "Fracture |  (065)") isn't matched by it.
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
- **Condition**: the minimum is Lightly Played or better (a setting). MtgSingles `NM / SP`, the grade on most of its stock, counts as NM; other combined grades count as their worse half (`SP / LP` → LP). `N/A` passes and is tagged "condition not stated".
- **Language**: English only, with no setting.
- **Buyability (Fetch)**: `sellerOnHoliday` Listings are never used. `buyNowEnabled` is not a buyability flag: it is only true for business sellers, and individual sellers' Listings (`buyNowEnabled=false`, `offerEnabled=true`) still go in the cart at their listed price.

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
- `unmatched` Listings are dropped and listed in an expandable notice ("3 Listings couldn't be matched to a card… Show them"), with title, Store, Source, price, link and the card being searched for, so the buyer can spot a real card. Tokens, art cards and the like aren't listed.
- Titles ending in a rarity letter and collector number (Arctic Collect: "Brainstorm C 96", "Sol Ring Foil Buy-A-Box Promos P 1") are tried with the tail removed, then by shorter and shorter leading words, longest first. Other titles are never shortened.

## 7. Optimiser and the Trade-off Ladder

Decided in [What optimiser approach produces the Trade-off Ladder?](https://github.com/Ryski112/MagicFinder/issues/6) and [What does each rung of the Trade-off Ladder mean?](https://github.com/Ryski112/MagicFinder/issues/13). The full MILP model is in the [optimiser research](https://github.com/Ryski112/MagicFinder/blob/research/optimiser/docs/research/optimiser.md).

**Model**
- An exact MILP per rung, with constraint Σ y_s ≤ k.
- Quantities may be split across Listings and Stores.
- Postage is a step function of each Store's subtotal: a binary per tier or free threshold, with a lower bound on subtotal.
- Pickup Stores have zero postage but still count toward k.
- **Preferred Stores** (owner's change, 2026-10-20) are Stores the buyer can collect from easily. They are a Settings list (also a ☆ Prefer button on each Store of the Plan screen). Their cards cost no postage (only the Store's pickup fee, if any), and they do **not** count toward k: a "2-Store" Plan means 2 other Stores plus any preferred ones it uses. k_min and every rung are counted that way, so a list a preferred Store can cover alone has a rung with 0 other Stores, labelled "Preferred Stores only".
- **Runner-up Plans** (owner's change, 2026-10-20): on request ("Find the runner-up Plan" on a rung; it costs one solve, so it isn't done unasked), the best Plan whose set of Stores (preferred ones aside) differs from every shown rung's of the same kind. It is solved as the same model with a no-good cut on each shown Store set. The Plan screen then offers "See the runner-up Plan" with the price difference (and, for a Short Plan, how many more or fewer cards it covers), so the buyer can compare leaving out different cards.
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
- Below k_min: **Short Plans** for 1, 2 and 3 Stores (owner's change, 2026-10-17, reversing "no partial Plans"). Each leaves out the fewest copies, then is the cheapest way to buy the rest; the Plan never decides a card is "not worth" its price (owner's change, 2026-10-21, reversing the 2026-10-20 "worth it" rule): a dear card is covered and flagged +X% over CardKingdom, and the buyer decides. A card the buyer insisted on ("Don't exclude this card" on a left-out card) counts for more than all the others together. Short Plans come first in the Ladder, show "N of M cards", and list the cards they leave out (collapsible, with images). The status line still says "Fewest Stores that cover your list: N".

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
- A simple start screen: a headline, an Archidekt URL box with **Import**, the card searcher, a large paste box, and one primary **Find my cards** button.
- Beside the button, a one-line summary ("14 cards recognised, 1 not, basics skipped").
- **Review list** (open by default) shows the parsed lines: include checkboxes, unrecognised lines and skipped basics. A line whose list names a Printing reads "list says C21 #263 · any printing" with **🔒 only buy C21 #263**. Locked, it reads "🔒 only C21 #263" with **allow any printing**. A one-line note explains that MagicFinder buys the cheapest printing unless a line is locked. The lock shown is the one that will apply, including "Use the Printings from my list".

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
3. One click: the click itself opens a new tab ("Checking {Store} still has your cards…"), so browsers don't block it, and the tab goes to `/cart/<variant>:<qty>,…?storefront=true` once the check finishes, including when some lines were dropped. A note under the button says it replaces the Store's current cart. If pop-ups are blocked, the dialog shows the summary and an **Open my cart** button instead.
4. The MagicFinder tab shows nothing while the cart tab says what's happening, so the buyer can come straight back. Only when lines were dropped (sold out or unconfirmed), the Store can't take a cart link, or the tab was blocked or closed, does it show a dialog with the summary, e.g. "12/13 available, 1 price changed", and the dropped lines' Listing links.

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
| Compare with CardKingdom | Off |
| CardKingdom shipping to NZ | US$20 |
| Add 15% GST to CardKingdom prices | On |
| Theme | Dark |
| Staples basket (file only) | Lightning Bolt, Counterspell, Swords to Plowshares, Llanowar Elves, Sol Ring |

## 11. Install, run and licence

Decided in [Which packaging approach, and where do friends download it?](https://github.com/Ryski112/MagicFinder/issues/23).

- **Downloads (friends)**: `npm run package` builds `MagicFinder-windows-x64.zip` and `MagicFinder-linux-x64.tar.xz`: the official portable Node.js 24 runtime (checked against its `SHASUMS256.txt`) next to an esbuild bundle (`src/server/main.mjs`, `worker.mjs`), `dist/web`, `data/stores.yaml` and `node_modules/highs`, with `MagicFinder.cmd` / `MagicFinder.sh` launchers. Download, extract, double-click; the console window ("MagicFinder – keep this open") stops the app when closed. No installer, no code signing, no Electron.
- **Launchers**: `MagicFinder.cmd` explains how to extract the zip when it's run from inside it. A second launch opens the running copy (ports from 5180, recognised by `app: "MagicFinder"` in `/api/status`), except in dev mode or with `MAGICFINDER_PORT` set.
- **Releases**: push tag `vX.Y.Z` matching `package.json`. The Release Action tests, builds, smoke-tests each archive on its own OS (`scripts/smoke-package.mjs`, plus the Windows launcher), and publishes a GitHub Release. Downloads use `releases/latest/download/<file>` links in the README's Install section.
- **Update notice**: at most once a day, `GET /repos/Ryski112/MagicFinder/releases/latest`; a newer, undismissed version shows a banner (Download · What's new · not now). Silent on failure; skipped in dev mode. No self-updating.
- **From source**: install Node, clone, `npm install`, `npm start` (or `start.sh` / `start.bat`). Still supported beside the downloads; both share the user data folder.
- **Repo**: private for now, with collaborators invited. Make it public under **MIT** once the app works; it must be public before the first release to friends (releases of a private repo are 404 for them, and the update check needs it); the owner decides when.
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
