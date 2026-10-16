# Card and Printing identity across Sources

Research for [#5](https://github.com/Ryski112/MagicFinder/issues/5). Researched 2026-10-16 against Scryfall's own docs and live API responses. Terms (Want List, Source, Store, Listing, Printing) are as defined in `CONTEXT.md`.

## Question

How should MagicFinder identify a card and a Printing so that Want List lines and Listings from different Sources match reliably? Covers names (double-faced, split, adventure), set codes, collector numbers, treatments, images, and Scryfall's terms of use.

## Recommendation

1. **Use Scryfall as the reference catalogue.** Download the `default_cards` bulk file daily and match against your own copy of it. Do not call the API once per Listing.
2. **Card key = Scryfall `oracle_id`.** It stays the same across reprints and tells apart different cards that share a name. For a `reversible_card`, use the `oracle_id` on each face.
3. **Printing key = (Scryfall `id`, finish).** A Scryfall `id` stands for one set, collector number and language. Foil, non-foil and etched are *not* separate Scryfall objects; they are values in that object's `finishes` array. Our Printing therefore needs the finish added to the Scryfall `id`. A readable form for logs and URLs: `set:collector_number:lang:finish`, e.g. `neo:357:en:foil`.
4. **Treatments (showcase, borderless, extended art, …) come from Scryfall fields.** They are labels on a Printing, not part of its key: the Scryfall `id` already tells them apart, because each treatment has its own collector number.
5. **Match Listing titles in two stages.** First find the card (`oracle_id`) from the name; this should almost always work. Then narrow it to a Printing using whatever set, collector number, finish and treatment hints the Listing gives. If more than one Printing is left, keep the Listing matched to the card, mark the Printing as uncertain, and never guess. The default "cheapest Printing" behaviour only needs the card match. Printing precision matters only once the buyer locks in a Printing (see #8).

## Scryfall facts

### Identifiers on a card object
Source: <https://scryfall.com/docs/api/cards>

| Field | What it is | Use for us |
|---|---|---|
| `id` | "A unique ID for this card in Scryfall's database." One object per set + collector number + language. | Base of the Printing key |
| `oracle_id` | "consistent across reprinted card editions, and unique among different cards with the same name (tokens, Unstable variants, etc)". Missing on `reversible_card`, where it "will be found on each face instead". | Card key |
| `set` / `set_name` / `set_id` | Set code, full set name, set UUID | Matching set hints in Listings |
| `collector_number` | A **string**: "can contain non-numeric characters, such as letters or ★" | Part of Printing; never parse it as an integer |
| `lang` | Language code of this print | Part of Printing (built into `id`) |
| `finishes` | Array of `foil`, `nonfoil`, `etched` | Finish part of the Printing key |
| `frame_effects`, `frame`, `border_color`, `full_art`, `promo`, `promo_types`, `variation`, `variation_of`, `textless`, `security_stamp` | Visual and promo traits | Treatment labels and filters |
| `tcgplayer_id`, `tcgplayer_etched_id`, `cardmarket_id`, `multiverse_ids`, `mtgo_id`, `arena_id` | External IDs | A shortcut if a Source exposes any of these |
| `flavor_name` | "The just-for-fun name printed on the card (such as for Godzilla series cards)" | Extra name alias |
| `printed_name` | Name printed on a localised card | Alias for non-English Listings |
| `games`, `digital` | Which games the print exists in; `digital` is "only released in a video game" | Filter to `games` containing `paper` and `digital == false` |
| `image_uris`, `card_faces[].image_uris`, `image_status` | Image links and their quality | GUI images |

Live checks (via `/cards/search?unique=prints`, 2026-10-16):
- Fable of the Mirror-Breaker has 6 prints. These include `neo 141` (normal), `neo 357` (`frame_effects: [showcase, fandfc, inverted]`), `neo 465` (`[extendedart, …]`), `pneo 141s` (`promo_types: [prerelease, datestamped]`, foil only), and a digital-only `prm` print. Each treatment has its own collector number, so the Scryfall `id` already tells treatments apart.
- Sol Ring has 139 prints. They include collector numbers such as `1494★`, `IFIYW-10` and `410z`, and some prints in the `qya` (Quenya) language. This confirms that collector numbers are opaque strings and that `lang` matters.
- Finishes vary per print: e.g. `sld 1494` is `[nonfoil]` and `sld 1494★` is `[foil]`. Many prints are `[nonfoil, foil]` under a single `id`.

### Names and multi-face cards
Sources: <https://scryfall.com/docs/api/cards>, <https://scryfall.com/docs/api/layouts>

- For multi-face cards, `name` contains "both names separated by ␣//␣". Examples from the live API: `Fable of the Mirror-Breaker // Reflection of Kiki-Jiki` (layout `transform`), `Bonecrusher Giant // Stomp` (`adventure`), `Fire // Ice` (`split`). `card_faces[].name` holds each face's name.
- The layouts that matter for paper singles are `normal`, `split`, `flip`, `transform`, `modal_dfc`, `meld`, `adventure`, `prepare`, `saga`, `class`, `case`, `leveler`, `mutate`, `prototype`, `battle` and `reversible_card`. Layouts such as `token`, `double_faced_token`, `emblem`, `art_series`, `planar`, `scheme`, `vanguard` and `front_card` are not normally on a Want List and should be excluded from the name index by default.
- A `reversible_card` is "two distinct Magic cards or tokens printed on opposite sides", e.g. Secret Lair's `Command Tower // Command Tower`. Its `oracle_id` is on the faces. For matching, treat it as a Printing of the face card.
- The card-names catalogue (`/catalog/card-names`) has 35,176 names, 97 of them with non-ASCII characters (e.g. `Barad-dûr`, `Arwen Undómiel`).
- **Collisions after normalisation** (lowercase, strip accents and punctuation, plus front-face aliases). I checked the full catalogue. Leaving out `X // X` reversible names, 11 keys collide:
  - Un-set and joke names that differ only by a comma, e.g. `Lava Axe` / `Lava, Axe`, `Rampant Growth` / `Rampant, Growth`, `Glimpse the Unthinkable` / `Glimpse, the Unthinkable`.
  - Front-face aliases that clash with a real card: `Bind` / `Bind // Liberate`, `Smelt` / `Smelt // Herd // Saw`, `Start // Finish` / `Start // Fire`.
  - `Monster Mash-Up` / `Monster Mashup`.

  So stripping punctuation is safe almost everywhere. Keep a precomputed collision list, and for those keys only, require a punctuation-preserving exact match or the full `A // B` name.
- `/cards/named` matches names case-insensitively, and "punctuation is optional". Its `fuzzy` mode returns a card only when the server is "confident that you unambiguously identified a unique name", and otherwise returns 404 (<https://scryfall.com/docs/api/cards/named>). This makes it a good fallback for leftover misspellings. It is rate-limited to 2 requests per second.

### Treatments
Source: <https://scryfall.com/docs/api/frames>, card fields above

| Buyer-facing treatment | Scryfall signal |
|---|---|
| Foil / Non-foil / Etched (finish) | `finishes` contains `foil` / `nonfoil` / `etched`. `etched` can also appear in `frame_effects`. |
| Showcase | `frame_effects` contains `showcase` |
| Extended art | `frame_effects` contains `extendedart` |
| Borderless | `border_color == "borderless"` |
| Full art | `full_art == true` |
| Retro frame | `frame` is `1993` or `1997` on a modern-era print |
| Special foils (surge, galaxy, rainbow, halo, confetti, double rainbow, etc.) | `promo_types` (e.g. `surgefoil`, `galaxyfoil`, `doublerainbow`) |
| Serialized | `promo_types` contains `serialized` |
| Prerelease / date-stamped / buy-a-box / store championship | `promo_types` (`prerelease`, `datestamped`, `buyabox`, `storechampionship`) |
| Universes Beyond | `promo_types` contains `universesbeyond` |

Notes:
- Scryfall's full `frame_effects` list also has values that are not treatments (`legendary`, `fandfc`, `sunmoondfc`, `inverted`, `snow`, …). Use only the subset above for labels.
- `promo_types` is an open list, and new values appear with new products (`surgefoil`, `ffvii` and others in the Sol Ring data). Map known values to labels and pass unknown ones through unchanged.

### Bulk data
Source: <https://scryfall.com/docs/api/bulk-data> and `GET https://api.scryfall.com/bulk-data` (2026-10-16)

| File (`type`) | Content | Compressed size |
|---|---|---|
| `oracle_cards` | One object per `oracle_id` | ~24 MB |
| `unique_artwork` | One per artwork | ~37 MB |
| **`default_cards`** | Every card "in English or the printed language if the card is only available in one language" | ~76 MB |
| `all_cards` | Every card in every language | ~382 MB |

- The files are **gzipped JSONL** (`jsonl_download_uri`, e.g. `https://data.scryfall.io/default-cards/default-cards-<timestamp>.jsonl.gz`). They can be streamed line by line without loading the whole file into memory, which suits a NAS. The file URLs change daily, so read them from `/bulk-data/default_cards` each time.
- Files are regenerated "once every 12-24 hours". Prices "should be considered dangerously stale after 24 hours". We get prices from Stores anyway, so ignore Scryfall prices.
- `default_cards` is the right file. It contains every Printing NZ Stores realistically sell, while being about a fifth the size of `all_cards`. Non-English Listings can still be matched to the card through `printed_name`, or by a one-off API call to `/cards/:code/:number/:lang`.
- `GET /cards/manifest` (10 requests per minute, 15,000 entries per page) lists what changed. `/migrations` reports `merge`/`delete` of Scryfall IDs. Apply migrations to any stored Printing keys (for example, a buyer's locked-in Printings).

### Rate limits and required headers
Source: <https://scryfall.com/docs/api/rate-limits>, <https://scryfall.com/docs/api>

- `/cards/search`, `/cards/named`, `/cards/random`, `/cards/collection`: **2 requests per second**. `/cards/manifest`: 10 per minute. Everything else: 10 per second. File hosts at `*.scryfall.io` (bulk files and images) "do not have rate limits".
- An HTTP 429 response limits access for 30 seconds. Continuing to overload "may result in a temporary or permanent ban". Ignoring 429 responses "is not acceptable".
- Scryfall asks clients to cache data "at least for 24 hours". To "rapidly look up card names … or resolve a large number of card images, you **must** use the bulk data files."
- Every request needs an accurate `User-Agent` (e.g. `MagicFinder/1.0`) and an `Accept` header.
- `/cards/collection` accepts up to 75 identifiers per POST (`id`, `oracle_id`, `name`, `name+set`, `collector_number+set`, …), which is useful for one-off top-ups.

### Licence and usage terms (data and images)
Source: <https://scryfall.com/docs/api> ("Use of Scryfall Data and Images"), <https://company.wizards.com/en/legal/fancontentpolicy>

Data:
- Free use is allowed "for the primary purpose of creating additional Magic software". You must not imply Scryfall endorses the app or use its logos. You must not paywall Scryfall data; any account system must allow anonymous or free access. You must not "simply repackage, republish, or proxy Scryfall data"; the software "must create additional value".
- MagicFinder is a free, self-hosted price and Plan optimiser, so it fits. **Do not** build a pass-through card-lookup endpoint that just re-serves Scryfall JSON.

Images:
- Do not crop off the copyright or artist name. Do not distort, re-colour, blur, watermark, or present images as non-WotC.
- If the GUI uses `art_crop`, it must show the artist and copyright in the same view, or the full card elsewhere in the same view. **Simplest choice: always show full-card images** (`small` 146×204 / `thumb` WEBP for lists, `normal` 488×680 / `grid` WEBP for detail views).
- For double-faced layouts (`transform`, `modal_dfc`, `reversible_card`), `image_uris` sits on each `card_faces[i]` and not on the root (checked for Fable and Delver). Split and adventure cards have root `image_uris` (checked for Fire // Ice and Bonecrusher Giant). Code must handle both.
- Check `image_status` (`missing`, `placeholder`, `lowres`, `highres_scan`) and show a fallback for `missing`/`placeholder`.
- Images on `cards.scryfall.io` are not rate-limited, so hotlinking from the browser is fine. A local image cache on the NAS is optional.

Footer:
- Add a footer saying the app is unofficial Fan Content, not endorsed by Wizards of the Coast, with a WotC copyright credit, as in WotC's Fan Content Policy and Scryfall's own footer.

## How Sources label Printings (preliminary; owned by #2 and #3)

I did not inspect any Listing data. Both Sources render in the browser with JavaScript, and the detailed analysis belongs to #2 (Fetch TCG) and #3 (MtgSingles). What I observed read-only:

- **MtgSingles** (`mtgsingles.co.nz`) is an aggregator. Its page metadata describes searching "across New Zealand and Australia game shops". It loads data from `api.mtgsingles.co.nz` and preconnects to `cdn.shopify.com`. This *suggests* many of its Stores are Shopify shops, whose product titles are free text set by each Store. The common POS convention is something like `Card Name (Borderless) [Set Name]` with a separate finish variant, but **this is unverified**. Expect titles to differ from Store to Store.
- **Fetch TCG** (`fetchtcg.com`) is a marketplace where sellers "scan cards to create listings". That implies Listings are tied to Fetch's own card catalogue, so they probably come with structured set and finish fields, and possibly a TCGplayer or Scryfall ID. **Unverified.**
- Action for #2 and #3: record for each Source which fields come structured (name, set code or set name, collector number, finish, language, condition) and whether any external ID is present (`tcgplayer_id`, `cardmarket_id`, Scryfall `id`). If an external ID is present, map it straight to a Printing via the bulk file and skip title parsing.

## Matching strategy (Listing title → Printing)

Build these indexes locally from `default_cards`. Keep only prints whose `games` include `paper`, and leave out the non-card layouts listed above:

- `nameKey → {oracle_id}`, built from the full `name`, each `card_faces[].name` (front face especially), `flavor_name` and `printed_name`. Also keep a punctuation-preserving index for the collision list.
- `setNameKey | setCode → set code`, from `/sets` (1,059 sets; codes are 3 to 6 characters; no two set names are the same).
- `(set, collector_number) → Scryfall id`, and `oracle_id → [Printings]`.
- If Sources expose them: `tcgplayer_id`, `tcgplayer_etched_id` and `cardmarket_id` → Scryfall id.

For each Listing:

1. **Use a structured ID if one exists.** An external ID or set + collector number goes straight to the Printing. Done.
2. **Pull hints out of the title.** Remove and record:
   - set (text in `[...]` or `(...)` that matches a set name or code);
   - collector number (`#123`, `123/280`, `★`);
   - finish words (`foil`, `non-foil`, `etched`; special foils such as `surge`, `galaxy`);
   - treatment words (`borderless`, `showcase`, `extended art`, `retro`, `full art`, `serialized`, `prerelease`, `promo`);
   - condition (`NM`, `LP`, `MP`, `HP`, `DMG`);
   - language words.

   Keep a configurable list of these words for each Source.
3. **Find the card.** Normalise what's left (NFKD, remove accents, lowercase, straighten curly apostrophes, treat `/`, `//` and ` // ` as one separator, remove other punctuation, squash spaces). Look it up in `nameKey`, which also catches front-face-only titles such as "Bonecrusher Giant" and "Delver of Secrets". If that fails, call Scryfall `/cards/named?fuzzy=` (2 requests per second, cache the result for at least 24 hours). If that fails too, mark the Listing **unmatched** and log it for review.
4. **Find the Printing.** Take the card's Printings and filter them by set, then collector number, then treatment flags, then finish. If exactly one is left, the match is **exact**. If more than one is left (e.g. the title gives a set but not the frame), the match is **card-only**: keep the candidate Printings, and do not guess.
5. **Record match confidence** (`exact` / `card-only` / `unmatched`) on each Listing. #8 decides which levels count for a Want List line. The Want List side uses the same resolver; Archidekt exports usually include set and collector number (see #4), so they mostly resolve as `exact`.

Things that will trip us up:
- Collector numbers with `★`, letters or prefixes.
- Treatment variants inside one set.
- Prints that exist only in foil (`finishes` = `[foil]`).
- Store titles that use set *names* rather than codes.
- Secret Lair `sld` prints that share a card name.
- The 11 name collisions above.
- Digital-only prints (`digital: true`, e.g. `prm`), which must be excluded.

## Open questions

- Which structured fields and IDs each Source exposes (#2, #3). This decides how often we need step 2 at all.
- Whether non-English Listings are in scope. If they are, we need `printed_name` from `all_cards` or per-card API calls, because `default_cards` holds only English, or the single language a card was printed in.
- Whether a `card-only` match counts for a locked-in Printing (#8).

## Sources

- Scryfall API overview, required headers, data and image usage rules: <https://scryfall.com/docs/api>
- Rate limits: <https://scryfall.com/docs/api/rate-limits>
- Bulk data: <https://scryfall.com/docs/api/bulk-data>; live listing `https://api.scryfall.com/bulk-data`
- Card objects: <https://scryfall.com/docs/api/cards>
- Layouts and faces: <https://scryfall.com/docs/api/layouts>
- Frames and frame effects: <https://scryfall.com/docs/api/frames>
- Card imagery: <https://scryfall.com/docs/api/images>
- `/cards/named`: <https://scryfall.com/docs/api/cards/named>
- `/cards/collection`: <https://scryfall.com/docs/api/cards/collection>
- `/cards/search` (`unique=prints`): <https://scryfall.com/docs/api/cards/search>
- `/cards/manifest`: <https://scryfall.com/docs/api/cards/manifest>
- Card migrations: <https://scryfall.com/docs/api/migrations>
- Live API samples (2026-10-16): `/cards/named?exact=…` for Fable of the Mirror-Breaker, Delver of Secrets, Bonecrusher Giant and Fire // Ice; `/cards/search?unique=prints` for Sol Ring and Fable; `/catalog/card-names`; `/sets`
- Wizards of the Coast Fan Content Policy: <https://company.wizards.com/en/legal/fancontentpolicy>
- MtgSingles and Fetch TCG home pages (page metadata only): <https://mtgsingles.co.nz/>, <https://www.fetchtcg.com/>
