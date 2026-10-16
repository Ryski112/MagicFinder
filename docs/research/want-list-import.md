# Want List import: formats and Archidekt access

Research for issue #4. Covers the formats a **Want List** importer has to accept: Archidekt text, CSV and API; Moxfield; MTG Arena; MTGO; and plain `4 Lightning Bolt`. It also proposes one normalised line shape that every parser outputs.

Researched 2026-10-16. Everything was read-only: no accounts, no logins, no form submissions. Sample lines below come from real public decks (Archidekt deck `1585124` "Baby Lasagna"; Moxfield decks `jT8Y9X4tlUmeNZ2AjkD1Vg`, `fNVWuTplbU6rxeJA-jkMWQ`, `qJtOGwj_PEOPcB06vfl9qQ`, `D_12zvQhSUyi3MDloiCGEg`), unless marked otherwise.

## TL;DR

1. **Accept pasted text as the main input.** One forgiving line parser covers Archidekt text, Moxfield, Arena, MTGO and plain lists. The grammar is `qty[x] name [(SET) [collector#]] [*F*|*E*] [[categories]] [^label^]`, plus section-header lines.
2. **Archidekt URL import is possible.** `GET https://archidekt.com/api/decks/{id}/` needs no auth and returns JSON with quantity, name, set code, collector number, finish (`modifier`) and categories. It is undocumented and only sends CORS headers for `http://localhost:3000`, so it has to be called **server-side** and not from the browser.
3. **Moxfield URL import is not viable.** `api2.moxfield.com` blocks non-browser clients with a Cloudflare challenge (HTTP 403 "Attention Required"). Users have to paste Moxfield exports.
4. **Don't build an Archidekt CSV importer.** The CSV export is malformed: header and data columns don't line up, and some separators are missing (details below).
5. Name matching has to cope with **four spellings of a two-faced card**: `A // B`, `A / B`, `A/B`, and the front face `A` alone. Match on the front-face name.

## 1. Archidekt

### 1a. Export dialog (UI)

Path: deck page, then **More**, then **Misc**, then **Export deck**. The dialog has these controls, as observed:

- **Select cards by**: "All cards", plus the checkbox "Include out of deck cards (eg: maybeboard)".
- **Export type**: `Text`, `CSV`, `Arena`, `MTGO.dek`, `Deck Registration PDF`, `EDHREC Article`.
- **Text, Export options**: one checkbox each for "Include x in quantity", "Include set code", "Include collector number", "Include foil indicator", "Include categories" and "Include color tag data". The template shown is `1x Example Card (set) 123 *F* [Example category] ^Buy,#0066ff^`.
- **Text, Section header**: `No section header`, `Primary category`, `Card type`, `Generic (eg: Commander, Mainboard, Sideboard)`.
- **Text, checkbox**: "Use front name only for MDFC cards".
- **CSV, Enabled columns**: Quantity, Name, Edition name, Edition code, Edition date, Collector number, Category, Secondary categories, Label, Price, Collection, Modifier, Salt, Color, Mana value, Rarity, Scryfall ID, Types, Card Text, Mana Cost. There is also an optional header line.
- **Arena**: the only option is Copy. The dialog warns that Arena accepts only Arena-available editions.

### 1b. Text export: sample (all options on, Generic headers)

```
Commander
1x Baba Lysaga, Night Witch (clb) 525 *E* [Commander{top}]

Mainboard
1x Arachnogenesis (c15) 32 [Disruption]
1x Drag to the Roots (dsk) 213 *F* [Disruption]
1x Starscream, Power Hungry // Starscream, Seeker Leader (bot) 5 [Endgame Plans]
2x Forest (hou) 189 [Land]
2x Snow-Covered Swamp (mh1) 252 [Land]

Maybeboard
1x Aspect of Mongoose (tsp) 191 [Maybeboard{noDeck}{noPrice},Potion Ingredients]
```

Notes:
- Quantity has an `x` suffix. Set codes are **lowercase**.
- Foil is written `*F*` and etched foil `*E*`.
- Categories sit in `[...]` and are separated by commas. A category can carry flags in braces: `{top}` marks the premier/commander category, and `{noDeck}{noPrice}` marks a category excluded from the deck (the maybeboard).
- DFC (transform) cards use the full `Front // Back` name unless the "front name only" box is ticked.
- Colour-tag data `^Label,#hex^` only appears on cards that have a label. None did in this deck.

### 1c. Arena export: sample

```
1 Sanctum Weaver (MH2) 171
1 Deadly Tempest () 19
1 Starscream, Power Hungry () 5
1 Invasion of Ikoria (MOM) 190
2 Swamp (AKH) 252
1 Baba Lysaga, Night Witch () 525
```

Notes:
- There are **no section headers**. The commander is mixed in with the other cards, and the maybeboard is dropped (100 of 116 cards were exported).
- Editions that aren't on Arena produce **empty parentheses `()`** but keep the collector number. The parser must accept `()` and treat it as "no set". The collector number is meaningless without a set, so drop it too.
- DFCs export as the front-face name only.

### 1d. CSV export: avoid

Real output with all columns and the header line on:

```
Quantity,Name,Edition name,Edition code,Edition dateCategory,Secondary categories,Label,Finish,Collector number,Salt,Colors,Mana Value,Rarity,Scryfall ID,Types,Price,Collector Number,Card text,Mana cost
1,Animate Dead,Premium Deck Series: Graveborn,pd3,18/11/2011,Recursion,"",default,Foil,16,0.55,"Black",2,uncommon,54aca743-...,"Enchantment",11.99,not owned,"Enchant creature ...","2G"...
```

Problems with this output:
- The header is missing a comma (`Edition dateCategory`).
- The header labels don't match the data. The value under "Finish" is actually the label, and the value under the second "Collector Number" is the collection status (`not owned`).
- The "Card text" field runs straight into the mana cost with no comma between them (`..."2G`).
- Dates are `DD/MM/YYYY`.

Treat this format as unreliable. If CSV support is ever needed, a minimal export of Quantity, Name, Edition code, Collector number and Modifier is probably safe, but it hasn't been verified, so prefer text.

### 1e. Public deck API (URL import)

`GET https://archidekt.com/api/decks/{deckId}/`. This was verified with a browser User-Agent and no cookies. It returned 200 with JSON, and 404 for a deck ID that doesn't exist.

Fields relevant to a Want List line, from `cards[]`:

| Want List field | JSON path | Example |
|---|---|---|
| quantity | `quantity` | `1` |
| name | `card.oracleCard.name` (DFCs use `A // B`, faces in `card.oracleCard.faces[].name`) | `Sanctum Weaver` |
| set | `card.edition.editioncode` (lowercase) | `mh2` |
| collector number | `card.collectorNumber` (string) | `171` |
| finish | `modifier`: `Normal` / `Foil` / `Etched` | `Foil` |
| section | `categories[]` (strings), resolved against the deck-level `categories[]` objects `{name, isPremier, includedInDeck, includedInPrice}` | `["Maybeboard","Potion Ingredients"]` |
| printing id | `card.uid` (Scryfall printing UUID), `card.oracleCard.uid` (Scryfall oracle id) | `4d42e22d-…` |

Section rules, as observed:
- **Commander** is the category with `isPremier: true`.
- **Maybeboard** has `includedInDeck: false`. Sample decks also had cards tagged both `Maybeboard` and something else, for example `["Maybeboard","Mana Boost"]`, so check every category on a card, not just the first.
- **Sideboard** is a category named `Sideboard`, which had `includedInDeck: true` in the five Standard decks checked.
- All other categories are user-defined labels ("Ramp", "Potion Ingredients"). They aren't sections.

Other observations:
- Listing endpoint `GET /api/decks/v3/?orderBy=-viewCount&pageSize=N` also works without auth.
- CORS: the response sends `access-control-allow-origin: http://localhost:3000` no matter what `Origin` the request has. **Browser-side fetch from our domain will fail**, so proxy it through our backend.
- `robots.txt` doesn't disallow `/api/`.
- The API is undocumented and unversioned (except `/v3/` on listing), so it may change without notice. Keep the adapter small and fall back to paste.
- Private decks weren't tested (that needs an account). Expect a 403 or 404, and show "deck is private, paste an export instead".
- URL shape: `https://archidekt.com/decks/{id}/{optional-slug}`. Extract with `/archidekt\.com\/decks\/(\d+)/`.

## 2. Moxfield

Source: Moxfield's own export endpoints and production JS bundle, read in a normal browser session (no login). The help pages and API return HTTP 403 to plain HTTP clients (Cloudflare), so **server-side URL import is not feasible**.

The UI calls `GET api2.moxfield.com/v2/decks/all/{publicId}/export?format=…&exportId=…` with format values `full` and `mtgo`, and `…/export/arena?format=mtga` for Arena. Any other value returns `400 "The value 'X' is not valid for Format."`.

### 2a. Moxfield format (`format=full`, "Copy for Moxfield")

```
1 Najeela, the Blade-Blossom (BBD) 62 *F*
1 Arcane Signet (SLD) 1492★ *F*
1 Badlands (3ED) 282
2 Mountain (ALA) 243
4 Disciple of Freyalise / Garden of Freyalise (MH3) 250
2 Ajani, Nacatl Pariah / Ajani, Nacatl Avenger (MH3) 237

SIDEBOARD:
2 Wear / Tear (DMC) 174
1 Gaea's Cradle (USG) 321
```

Notes:
- Set codes are uppercase. Collector numbers can contain **non-digits** (`1492★`), so treat them as strings.
- Foil is `*F*` and etched is `*E*`, confirmed in the bundle: `"foil"===e.finish?"*F*":"etched"===e.finish?"*E*":""`.
- **Two-faced and split cards use a single slash, `A / B`**, for split (`Wear / Tear`), MDFC and transform cards alike.
- The commander is the **first line with no header**. The sideboard comes after a blank line and `SIDEBOARD:`. The maybeboard is not included.

### 2b. MTGO format (`format=mtgo`)

```
1 Ad Nauseam
2 Mountain
4 Disciple of Freyalise
2 Turntimber Symbiosis

SIDEBOARD:
2 Wear/Tear
1 Borne Upon a Wind

1 Najeela, the Blade-Blossom
```

Notes:
- Lines are name only.
- DFCs are **front face only**, and split cards are `A/B` with no spaces.
- In a Commander deck the commander is appended **after a second blank line with no header**. A parser that ignores sections still gets every card, but it can't tell the commander from the sideboard.

### 2c. Arena format (`/export/arena?format=mtga`)

```
About
Name  🌸 Warrior Queen [cEDH Najeela] 🌸

Commander
1 Najeela, the Blade-Blossom

Deck
1 Ad Nauseam
2 Mountain

Sideboard
2 Wear // Tear
```

Notes:
- The header lines are `About`, `Name …`, `Commander`, `Deck`, `Sideboard` and `Companion`. `Companion` comes from Arena's own format and wasn't in these samples.
- Split cards use `A // B` and DFCs use the front face.
- Arena's own client export also puts `(SET) collector#` after each name, for example `1 Sol Ring (CMM) 410`, which is the form quoted in the ticket. Moxfield's Arena export left it out.

## 3. MTG Arena (Wizards)

The official "Importing a Deck" support article (mtgarena-support.wizards.com, article 360049857771) gives only the minimal form: one `quantity name` per line, for example `4 Masked Blackguard`, `25 Swamp`. It doesn't document headers or set codes. The fuller grammar in §2c is the de-facto format other tools emit for Arena:

```
Deck
4 Lightning Bolt (2X2) 117
1 Sol Ring (CMM) 410

Sideboard
2 Wear // Tear (STX) 245
```

## 4. MTGO (Wizards)

- **Text (.txt)**: name-only lines, with the sideboard after a blank line. This is what Moxfield emulates in §2b (with an added `SIDEBOARD:` label). The client's own `.txt` export wasn't checked against a primary source, because MTGO's help isn't publicly indexed. Treat "blank line, then sideboard" as the convention.
- **.dek (XML)**: lines look like `<Cards CatID="49159" Quantity="4" Sideboard="false" Name="Doom Blade" />`. That example is from a third-party converter README (github.com/dylan/Pile), not a primary source. Archidekt can export `.dek`. It's out of scope for v1, because friends paste text and nobody uploads `.dek` files.

## 5. Plain list

```
4 Lightning Bolt
1 Sol Ring
10 Island
```

Variants seen across the formats above, which all need accepting: a `4x` quantity, extra spaces, a trailing `*F*`, and blank lines.

## 6. Edge cases

| Case | Seen as | Handling |
|---|---|---|
| Split card | `Wear // Tear` (Arena, Archidekt), `Wear / Tear` (Moxfield), `Wear/Tear` (MTGO) | Normalise ` // `, ` / ` and `/` to `//`, then match on the first face or the full name |
| Transform / MDFC | `A // B` (Archidekt), `A / B` (Moxfield), `A` only (MTGO, Arena) | Match on the front-face name |
| Adventure | `Questing Druid // Seek the Beast` (Archidekt API) | Same as split |
| Basic lands | `2 Swamp (AKH) 252`, `25 Swamp` | Import them like any other card. Whether to exclude them from the **Plan** is a product question, since friends usually own basics |
| Commander | Archidekt `Commander` header / `isPremier`; Moxfield full: first line; MTGO: trailing block; Arena: `Commander` header | Record as section `commander`. It's still a card to buy |
| Sideboard | `SIDEBOARD:`, `Sideboard`, Archidekt `Sideboard` category | Section `sideboard` |
| Maybeboard | Archidekt `Maybeboard` header / `includedInDeck:false`; Moxfield exports drop it | Section `maybeboard`, **excluded by default** |
| Empty set | Archidekt Arena export `()` | Treat as no set, and drop the collector number |
| Non-numeric collector # | `1492★`, `123a`, `DDO-20` style | Keep as a string |
| Set code case | Archidekt `mh2`, others `MH2` | Upper-case it |
| Etched foil | `*E*`, Archidekt `Etched` | Finish `etched` |
| Header noise | `About`, `Name …`, `Deck`, `Mainboard`, `Commander`, `Companion`, `SIDEBOARD:`, Archidekt custom category headers | A line with no leading quantity is a header. Map known names to sections, and treat anything else as `main` |
| Archidekt tags | `[Ramp,Maybeboard{noDeck}]`, `^Buy,#0066ff^` | Strip them. If a bracket list contains `Maybeboard` or `{noDeck}`, set the section to maybeboard |

## 7. Proposed normalised Want List line

The default is the cheapest **Printing** (see CONTEXT.md), so set, collector number and finish are only *hints*. Searching uses the name, and a hint becomes a filter only if the user asks for exact printings.

```ts
type WantListLine = {
  quantity: number;          // >= 1
  name: string;              // canonical oracle name; DFC/split as "Front // Back" (Scryfall style)
  set?: string;              // upper-case set code, e.g. "MH2"; absent if missing or "()"
  collectorNumber?: string;  // string, may contain non-digits ("1492★"); only kept if set present
  finish?: "foil" | "etched"; // absent = nonfoil / don't care
  section: "main" | "commander" | "companion" | "sideboard" | "maybeboard";
};
```

Single-line grammar for the paste parser, which is a superset of every format above:

```
^\s*(\d+)x?\s+(.+?)(?:\s+\(([A-Za-z0-9]*)\)(?:\s+(\S+))?)?(?:\s+\*([FE])\*)?(?:\s+\[[^\]]*\])?(?:\s+\^[^^]*\^)?\s*$
```

Group 1 is quantity, 2 name, 3 set (may be empty), 4 collector number, 5 finish. Strip a trailing `[categories]` before matching, and check it for `Maybeboard` / `{noDeck}`. A line with no leading digits is a section header, ignoring case and a trailing `:`:

- `commander` → commander
- `companion` → companion
- `sideboard` → sideboard
- `maybeboard` or `considering` → maybeboard
- `deck` or `mainboard` → main

Ignore `About` and `Name …`. A blank line on its own changes nothing, except under the MTGO convention: if there are no explicit headers, cards after the first blank line are `sideboard`.

After parsing, merge duplicate lines with the same name, set, collector number, finish and section by summing their quantities. Resolve names against a card database (e.g. Scryfall) so that `A / B`, `A/B` and front-face-only names all become the canonical `A // B`.

## 8. Recommendation for v1

1. Build the paste parser described in §7. It covers Archidekt text and Arena exports, Moxfield full, MTGO and Arena exports, Arena client exports, and plain lists.
2. Add Archidekt URL import through a server-side fetch of `/api/decks/{id}/`, mapping fields as in §1e. If that fails, tell the user to paste an export instead.
3. Leave out Moxfield URL import (blocked by Cloudflare), Archidekt CSV (malformed) and MTGO `.dek` (nobody pastes it).
4. Exclude the maybeboard by default. Include the commander and sideboard, with a toggle per section.

## Sources

- Archidekt deck API, fetched live: `https://archidekt.com/api/decks/1585124/`, `https://archidekt.com/api/decks/v3/?orderBy=-viewCount&pageSize=3`, `https://archidekt.com/robots.txt`.
- Archidekt Export dialog, inspected live at `https://archidekt.com/decks/1585124`. The export output was captured from the Copy button.
- Moxfield export endpoints, called from a moxfield.com browser session: `api2.moxfield.com/v2/decks/all/{id}/export?format=full|mtgo`, `/export/arena?format=mtga`, `/v3/decks/all/{id}`.
- Moxfield production bundle `assets.moxfield.net/assets/assets/moxfield.a8b163a5b8baeade1df0.js`, containing the finish marker function and the export request builder.
- MTG Arena support, "Importing a Deck": https://mtgarena-support.wizards.com/hc/en-us/articles/360049857771-Importing-a-Deck
- MTGO `.dek` example (secondary): https://github.com/dylan/Pile
