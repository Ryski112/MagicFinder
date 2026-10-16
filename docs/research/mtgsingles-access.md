# How can MtgSingles Listings be searched and read?

Research for issue #3 (parent map #1). Terms follow `CONTEXT.md`. All observations were made on **2026-10-16** against the live site from an NZ IP, read-only, at low request volume (about 15 API calls in total).

## TL;DR

- MtgSingles (mtgsingles.co.nz) is a **price-comparison aggregator**, not a seller. It surfaces Listings from about 40-50 NZ **Stores** (and about 30 AU Stores) and links each Listing to the Store's own product page. It is a **Source** in our sense.
- Search goes through one **JSON GET endpoint**: `https://api.mtgsingles.co.nz/MtgSingle?query=…`. It returns 20 Listings per page, sorted by price ascending.
- **That endpoint is behind Cloudflare bot protection.** A plain `curl` gets `403 "Sorry, you have been blocked"`, while the same URL fetched from a real browser session on mtgsingles.co.nz returns `200` JSON. The HTML pages are not blocked; only the API is.
- So in practice you need a **real browser** (headless or not) that loads mtgsingles.co.nz and calls the API from inside the page. Getting around Cloudflare with spoofed clients is something we should **not** do.
- robots.txt allows everything. The Terms do not forbid automated access, but they don't grant it either, and the operator is evidently choosing to block non-browser API clients. **Recommended approach: ask the operator for permission or an API key** (contact page). Until then, use MtgSingles only as a low-volume, browser-driven Source, or as a directory for finding Stores to query directly.
- Each Listing includes Store, set name, title, condition, price (string NZD), quantity, treatment "features", image, and a referral link to the Store's product page. It does **not** include collector number, language as a field, Store location, or a last-updated timestamp.

## 1. What MtgSingles is

- Site self-description: "We search within more than 400,000 Magic: The Gathering card prices from a total of 39 game shops across New Zealand and more than 350.000 prices from a total of 19 game shops across Australia" (About page, https://mtgsingles.co.nz/info/about). The Store logo grid on the same page lists **51 NZ** and **32 AU** entries, so the "39" figure in the text is stale.
- It does not sell anything. Every Listing links out to the Store's own site, with `utm_source=mtgsingles` added (observed in API responses).
- It covers several TCGs (`tcgType=1` is MTG; the routes include `/yu-gi-oh/`, `/pokemon/`, `/flesh-and-blood/`, `/grand-archive/`, `/one-piece/`). There is a country toggle: `Country=1` is NZ. The AU site is served under `/au` (`main-7AAGVMC4.js`, `buildCountryTargetUrl`).

## 2. NZ Stores covered

Taken from the About page logo grid (name and linked Store site), 2026-10-16. Store keys follow the API's `store` field format (`NZ/<Key>`).

| Store | Site | API key |
|---|---|---|
| Badgers Sett | badgerssettnz.com | NZ/BadgersSett |
| Bay Dragon | baydragon.co.nz | NZ/BayDragon |
| BeaDnD Games | beadndgames.co.nz | NZ/BeaDnd |
| Bulbastore | bulbastore.co.nz | NZ/Bulbastore |
| Calico Keep | calicokeep.co.nz | NZ/CalicoKeep |
| Card Bard | cardbard.co.nz | NZ/CardBard |
| Card Baron | cardbaron.co.nz | NZ/CardBaron |
| Card Masters | cardmasters.co.nz | NZ/CardMasters |
| Card Merchant (and branches: Blenheim, Christchurch, Dunedin, Hamilton, Nelson, New Plymouth, Ponsonby, Silverdale, Takapuna, Taupo, Wellington, Whangarei) | cardmerchant.co.nz, cardmerchant<branch>.co.nz | NZ/CardMerchant, NZ/CardMerchant<Branch> |
| Card Slayer | cardslayer.co.nz | NZ/CardSlayer |
| Card Spot | cardspotnz.com | NZ/CardSpot |
| Collectors Guild | collectorsguild.co.nz | NZ/CollectorsGuild |
| Game Roost | gameroost.co.nz | NZ/GameRoost |
| Games Lab | gameslab.co.nz | NZ/GamesLab |
| Gaming DNA | gamingdna.co.nz | NZ/GamingDNA |
| Goblin Games | goblingames.nz | NZ/GoblinGames |
| HobbiXchange | hobbixchange.co.nz | NZ/HobbiXchange |
| Hobby Lords | hobbylords.co.nz | NZ/HobbyLords |
| Hobby Master | hobbymaster.co.nz | NZ/HobbyMaster |
| Iron Knight Gaming | ironknightgaming.co.nz | NZ/IronKnightGaming |
| Kanto Corner | kantocorner.nz | NZ/KantoCorner |
| Magic at Willis | magicatwillis.co.nz | NZ/MagicAtWillis |
| Magic Red Dragon | magicreddragon.co.nz | NZ/MagicRedDragon |
| Meta Life | metalife.co.nz | NZ/MetaLife |
| MTG Magpie | mtgmagpie.com | NZ/MagicMagpie |
| Nova Games | novagames.co.nz | NZ/NovaGames |
| NZ Trading Cards | nztradingcards.com | NZ/NZTradingCards |
| Otaku Mart | otakumart.co.nz | NZ/Otakumart |
| PlayX | playx.co.nz | NZ/PlayX |
| Pop Stop | popstop.co.nz | NZ/PopStop |
| Shuffle and Cut | shuffleandcutgames.co.nz | NZ/ShuffleAndCut |
| Spellbound | spellboundgames.co.nz | NZ/Spellbound |
| TCG Collector NZ | tcgcollectornz.com | NZ/TcgCollectorNZ |
| TCG Culture | tcgculture.com | NZ/TCGCulture |
| The Game Tree | thegametree.co.nz | NZ/TheGameTree |
| Three Tree Market | threetreemarket.co.nz | NZ/ThreeTreeMarket |
| Valkyrie Games | valkyrie-games-nz.myshopify.com | NZ/ValkyrieGames |
| Vagabond | vagabond.co.nz | NZ/Vagabond |
| XP Games | xpgames.co.nz | NZ/XpGames |
| **Fetch TCG** (marketplace, not in the About grid) | fetchtcg.com | NZ/FetchTcg |

Notes:
- **Fetch TCG appears as a "marketplace".** Fetch TCG Listings came back as `NZ/FetchTcg` (33 of 59 Lightning Bolt Listings), and they disappear when `includeMarketplaces=false` is set (verified). Fetch TCG is a multi-seller marketplace, but MtgSingles attributes all of it to one "Store". It gives no individual seller identity, which we need for postage and Store count. **MagicFinder should read Fetch TCG as its own Source** and exclude marketplaces from MtgSingles (`includeMarketplaces=false`) to avoid double-counting.
- Logo grid ≠ guaranteed live coverage: the About text says 39 NZ shops. Stores actually seen in responses for our 3 test cards were BadgersSett, BayDragon, CardMerchant (Hamilton, Ponsonby, Silverdale, Whangarei, main), CollectorsGuild, FetchTcg, GoblinGames, HobbyMaster, IronKnightGaming, MagicAtWillis, MagicMagpie, MagicRedDragon, Otakumart, ShuffleAndCut, TcgCollectorNZ, CalicoKeep.
- **Integrated vs scraped Stores.** The bundle hard-codes `integratedStores = [NZ/GoblinGames, NZ/Otakumart, NZ/ShuffleAndCut, NZ/IronKnightGaming, NZ/MagicAtWillis, NZ/MagicMagpie, NZ/GameRoost, NZ/TcgCollectorNZ, NZ/BadgersSett, NZ/HobbiXchange, AU/ShuffleAndCutMelbourne]`. For these Stores the UI shows a "LIVE" badge: "Live pricing & inventory is available for integrated stores." (`main-7AAGVMC4.js`). Integration is through a MtgSingles Shopify app ("Your inventory will be synchronized automatically", https://mtgsingles.co.nz/shopify/welcome). All other Stores are presumably collected by MtgSingles' own periodic crawling (inferred, not stated).
- Store **location** isn't in the API. Some Store keys encode a branch town (Card Merchant branches). We would need our own Store table for location and postage either way.

## 3. Access: endpoints

The front end is an Angular SPA (`<app-root>`, `main-7AAGVMC4.js`), served behind Cloudflare. The page HTML contains no Listings, so scraping the HTML needs JS rendering. Data comes from:

### Search

```
GET https://api.mtgsingles.co.nz/MtgSingle
    ?query=<card name>          (min 3 chars, else the client returns [])
    &tcgType=1                  (MTG)
    [&isExactMatch=true]
    [&isSinglesOnly=true]       ("Singles and Sealed" toggle)
    [&feature=<f>]*             (repeatable)
    [&store=<NZ/Key>]*          (repeatable)
    [&condition=<c>]*           (repeatable)
    [&includeMarketplaces=false]
    &sortOrder=2                (price ascending; the only value the client sends)
    &page=<n>                   (1-based)
    &pageSize=20
    &Country=1                  (NZ)
```

Source: `buildUrl` in `main-7AAGVMC4.js` and observed `fetch` calls (Performance API on the search page).

- Response: a bare JSON **array** of Listings, with **no total count**. The client stops paging when a page has fewer than 20 items. `pageSize=100` was ignored (still 20 returned), so pages are capped at 20.
- Lightning Bolt (exact match, NZ) = **59 Listings over 3 pages**. Sol Ring exact had at least 2 full pages. A Want List of N cards therefore costs about N × (1-5) requests.
- The "Deck Search" UI page reuses the same per-card endpoint. There is no bulk/want-list endpoint in the bundle (the only POST is `/Feedback`).
- Other endpoints: `GET /MtgSingle/Carousel?preQuery=<bestSealedDeals|free|gameChangers|reserved|limited|secretLair>&Country=1` (homepage carousels, not useful).

### Bot protection (the key constraint)

- `curl` to the search URL (browser UA plus `Origin` header) → **HTTP 403**, a Cloudflare "Attention Required! / Sorry, you have been blocked" page.
- The same URL fetched by the page itself in a real browser → **HTTP 200** JSON.
- The site loads Cloudflare's JS challenge script (`/cdn-cgi/challenge-platform/.../jsd/main.js`). There is a commented-out Turnstile include in `index.html`.
- So **a headless or real browser is required in practice**. The data isn't JS-only in principle (it's a clean JSON API), but Cloudflare only lets in browser-like clients. Spoofing TLS fingerprints or cookie replay to get around this would be evading an access control the operator deliberately chose, which we should not do.

### Exact match and double-faced cards

- `isExactMatch=true` with "Delver of Secrets" returned only 4 Listings whose titles are just "Delver of Secrets" (or "… (Retro Frame)", "… (Foil)"). It **missed** the 16+ Listings titled "Delver of Secrets // Insectile Aberration".
- Without exact match, "Delver of Secrets" returns both forms. Searching the back face "Insectile Aberration" also finds the `//` titles.
- So for double-faced cards: search without exact match (or search the full "Front // Back" name), then match names ourselves. Exact match tolerates suffixes like "(Foil)" or "(FDC-163) - Commander: Foundations", so it's a token/prefix match, not strict equality.
- Without exact match, results include other cards containing the words. MagicFinder must do its own name normalisation (for example against Scryfall names).

## 4. Fields per Listing

Example (trimmed) from `query=Lightning Bolt`:

```json
{"store":"NZ/HobbyMaster","tcgType":"MTG",
 "setName":"Commander Legends: Battle for Baldur's Gate",
 "title":"Lightning Bolt (Showcase) (Foil) (SP)",
 "condition":"SP / LP","price":"$2.30",
 "url":"https://hobbymaster.co.nz/cards/card/1136915?utm_source=mtgsingles&utm_medium=referral&utm_content=card_details",
 "imageUrl":"https://cards.scryfall.io/normal/front/c/6/c69f….jpg",
 "searchUrl":null,"availableQty":1,"features":["Foil","Showcase"]}
```

| Needed (issue #3) | Available? | Notes |
|---|---|---|
| Store | Yes: `store` | Key like `NZ/HobbyMaster`. Marketplace sellers are collapsed into `NZ/FetchTcg`. |
| Store location | **No** | Only implied by some keys (Card Merchant branches). |
| Printing: set | Mostly: `setName` | Sometimes empty (TcgCollectorNZ, MagicRedDragon put set/number in `title` instead). |
| Printing: collector number | **No field** | Sometimes embedded in `title`, e.g. "(FDC-163)", "(0057)". |
| Treatment | Partly: `features[]` | Seen: Foil, Showcase, Borderless, Alternate Art, Retro, Foil-Etched, Non-English. **Unreliable**: Shuffle and Cut "Lightning Bolt, Marvel Super Heroes Commander, $7.00" had `features: []`, but on the Store the $7.00 variant is "Near Mint Foil" (the non-foil was out of stock). |
| Condition | Yes: `condition` | Normalised buckets: `NM / SP`, `SP / LP`, `MP`, `HP`, `D`, `N/A`. |
| Language | Partly | Only as feature "Non-English" or in the title ("(Japanese)", "(JP Alternate Art)"). |
| Quantity | Mostly: `availableQty` | `null` for some Stores (all Card Merchant Hamilton rows). The UI shows "Out of stock" for 0, but every Listing we saw was in stock. |
| Price | Yes: `price` | **String** with `$` and thousands separators, e.g. `"$1,345.99"`. NZD for Country=1. Needs parsing. |
| Link to Store product page | Yes: `url` | Has utm/referral params (strip or keep). Fetch TCG links go to a specific marketplace listing id. |
| Freshness / last updated | **No** | No timestamp in the payload or headers. |
| `searchUrl` | Rarely set | Always `null` in our samples. When set, the UI shows "From $x / View all" (a Store-level search link instead of a single Listing). |

Each Listing is one variant (Printing × condition × finish) at one Store. For example, Card Merchant Hamilton's product has 10 condition/foil variants, and MtgSingles returned only the in-stock "Near Mint" one.

## 5. Freshness

There's no timestamp, so we spot-checked 3 Listings against the Stores' live pages (2026-10-16):

| Listing (MtgSingles) | Store page now | Match? |
|---|---|---|
| HobbyMaster, Lightning Bolt (Foil), Commander: Marvel Super Heroes, $4.70, qty 2 | hobbymaster.co.nz/cards/card/1677832: $4.70, "2 in stock" | Yes |
| Card Merchant Hamilton, Lightning Bolt, Masters 25, NM, $2.50, qty null | Shopify `.js`: Near Mint 250 cents, available | Yes (price/stock); qty not exposed by the Store either |
| Shuffle and Cut (integrated), Lightning Bolt, Marvel Super Heroes Commander, $7.00, qty 2 | Shopify `.js`: only "Near Mint Foil" $7.00 available | Price/stock yes; **foil flag missing** |

Conclusion: data looked current for these samples. Integrated Stores say they sync live. Crawl frequency for the others isn't published. MagicFinder should treat MtgSingles prices as "probably current" and show the Store link for the buyer to confirm. Sitemaps show `lastmod 2026-10-12` (https://mtgsingles.co.nz/sitemap.xml), but that's for SEO pages, not Listing data.

## 6. robots.txt, Terms, legal

- **robots.txt** (https://mtgsingles.co.nz/robots.txt): `User-agent: * / Allow: /` plus a sitemap. Nothing is disallowed. (robots.txt for `api.mtgsingles.co.nz` was not checked separately because direct requests to that host are blocked.)
- **Terms and Conditions** (https://mtgsingles.co.nz/info/terms-and-conditions): no clause on scraping, crawling, bots or API use. Relevant points: MtgSingles owns its "software, branding, logos, and content", but this "does not include data submitted by stores or integration partners". Store-submitted data is licensed to MtgSingles "only to provide, maintain, secure, and improve the Service". Governed by NZ law.
  - Implication: listing data from **integrated** Stores is licensed to MtgSingles for its own Service only. Redistributing it through another tool is at least against the spirit of that licence. Prices and facts themselves are weakly protected, but the access-control angle matters more.
- **Disclaimer** (https://mtgsingles.co.nz/info/disclaimer): no warranty of "completeness, reliability and accuracy".
- **Privacy policy** (https://mtgsingles.co.nz/info/privacy-policy): logs query details, IP and device data, plus analytics/ads cookies (GA, Mixpanel, Mediavine, New Relic). No automated-access clause.
- **Business model**: ad-supported (Mediavine) plus "buy me a coffee". Automated API use bypasses their ads, so the operator has a commercial reason to object.
- **Cloudflare block**: the clearest signal of intent. Non-browser API access is actively refused.

## 7. Recommendation

1. **Ask first.** Use the contact page (https://mtgsingles.co.nz/info/contact) to ask the operator for permission or an API key for low-volume, non-commercial want-list lookups, crediting MtgSingles and keeping their referral links. This is a human action for the project owner. MagicFinder should not send it automatically.
2. **If permitted (or as an interim, personal, low-volume use):** drive a real browser (for example Playwright with a normal, headed or headless Chromium) to load `https://mtgsingles.co.nz/`, then call the search API from within the page via `fetch` for each Want List card. Use `includeMarketplaces=false`, no exact match (to catch DFCs), paging until fewer than 20 results, and roughly 1 request/second. Do not attempt to defeat Cloudflare challenges or spoof clients. If a challenge appears, stop.
3. **Normalise ourselves:** parse `price` strings, map `condition` buckets, extract Printing (set plus number from `setName`/`title`) and treatment from `features` plus `title`, and match card names against a canonical source (Scryfall).
4. **Use MtgSingles as a Store directory regardless.** The Store list above, especially the many Shopify Stores, is a ready-made list of NZ Stores. Many Stores (Card Merchant branches, Shuffle and Cut, TCG Collector NZ, Iron Knight Gaming, Goblin Games…) are on Shopify, which exposes public `products/<handle>.js` data. Querying Stores directly is an alternative Source strategy worth its own research ticket. It gives better treatment accuracy and real Store identity, but means N Stores × M cards requests and per-Store ToS checks.
5. **Treat Fetch TCG as a separate Source**, never via MtgSingles.

## 8. Open risks and unknowns

- **Access may be withdrawn at any time.** Cloudflare rules can tighten (for example Turnstile, which is already present but commented out), and headless Chromium may be challenged as well. This wasn't tested at volume.
- **Permission is unknown** until the operator replies. Without it, using the API outside their UI is ethically and legally grey (circumventing an access control), even though robots.txt allows crawling of the site.
- **Coverage is uncertain**: 51 NZ logos vs the "39 game shops" claim. No API lists active Stores. Non-integrated Stores' crawl recency is unknown.
- **Data quality**: treatment flags can be wrong (foil missing), there's no collector-number field, `availableQty` is null for some Stores, and `setName` is empty for some Stores.
- **No Store location, postage, or seller identity for marketplaces.** MagicFinder needs its own Store table (location, postage rules) keyed by the `NZ/<Key>` ids.
- **API is undocumented and versionless**: field names or parameters can change without notice (the bundle hash `main-7AAGVMC4.js` changes per deploy).
