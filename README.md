# MagicFinder

Finds the cheapest way to buy a list of Magic: The Gathering singles from New Zealand Stores, postage included. It searches **Fetch TCG** and **MtgSingles**, then shows a **Trade-off Ladder**: the cheapest Plan using 1, 2, 3… Stores, so you can decide how many separate orders a saving is worth.

It runs on your own computer and opens in your browser. Nothing is hosted anywhere.

## Install and run

You need **Node.js 22.13 or newer** ([nodejs.org](https://nodejs.org), the "LTS" download) and **git**.

```bash
git clone https://github.com/Ryski112/MagicFinder.git
cd MagicFinder
npm install
npm start
```

`npm start` builds the app, starts it, and opens `http://localhost:5180` in your browser. Leave the terminal window open while you use it; close it (or press Ctrl+C) to stop.

**One-click start:** after cloning, double-click `start.bat` (Windows) or run `./start.sh` (macOS/Linux). They install on the first run and start the app every time.

**First run:** MagicFinder downloads the card list from Scryfall (about 80 MB, once a day after that). The Want List screen shows progress.

**MtgSingles needs Chrome:** MtgSingles only answers real browsers, so MagicFinder reads it through a hidden Chrome, Chromium or Edge window using the one you already have. If none is installed it downloads Chromium once. You can switch MtgSingles off in Settings and use Fetch TCG alone.

## Using it

1. **Want List.** Paste a list (Archidekt, Moxfield, Arena, MTGO or plain `4 Lightning Bolt` lines) or paste an Archidekt deck link and press Import. "Review list" shows what was recognised; untick anything you don't want. Basic lands and the maybeboard are left out by default.
2. **Search.** MagicFinder asks each Source about every card, politely (about one request a second per Source). Results are reused for an hour.
3. **Choose a Plan.** Pick a rung of the Ladder. Each Store section lists the cards, prices, postage and a link to every Listing.
   - **Other Printings** shows every version in stock with its price. **Lock this one** pins that exact Printing and re-plans.
   - **I'll pick up** (Stores in your pickup city) removes their postage and re-plans. MagicFinder remembers it.
   - **Add all to cart** (most Stores) checks stock and prices, then opens the Store's cart with your cards in it. It replaces anything already in that Store's cart. You check out yourself. Fetch TCG has one cart for all its sellers, so it gets an "Open Fetch Listings" button instead.
   - Postage marked **est.** is a guess ($7 by default) because the Store doesn't publish its rates. Click it to enter what that Store really charges you.

**Settings** (⚙): postage type, pickup city, rural address, minimum condition (Lightly Played by default), foils, using the Printings from your list, basic lands, which Sources to search, the default postage guess, and light/dark mode.

When a Source stops answering, MagicFinder carries on with the other one, says which cards were only searched once, uses prices up to a day old if it has them, and waits 30 minutes before asking that Source again (or press **Try again now**).

## Where things are kept

Settings, the card list and the search cache live in your user data folder:

- Windows: `%APPDATA%\MagicFinder`
- macOS: `~/Library/Application Support/MagicFinder`
- Linux: `~/.local/share/magicfinder`

Set `MAGICFINDER_DATA_DIR` to use another folder, `MAGICFINDER_BROWSER` to point at a specific Chrome, or `MAGICFINDER_NO_OPEN=1` to stop it opening a browser tab.

## For developers

```bash
npm run dev        # API server + Vite with hot reload
npm test           # unit tests (recorded fixtures; never calls the live Sources)
npm run typecheck
```

- `CONTEXT.md`: the domain glossary (Want List, Source, Store, Listing, Printing, Plan, Landed Cost, Trade-off Ladder…). Use its words.
- `docs/spec.md`: the build spec, with links to every decision.
- `src/core`: Want List parsing, eligibility rules, Stores and postage.
- `src/catalogue`: the local Scryfall card catalogue and matching.
- `src/sources`: one module per Source (`fetchTcg.ts`, `mtgSingles.ts`) plus the shared block/retry policy. A new Source implements the `Source` interface in `src/sources/types.ts`.
- `src/optimiser`: the Trade-off Ladder: a fast greedy draft, then exact HiGHS solves in worker threads.
- `src/server`: the local API (Hono), search runs, planning, Archidekt import and the cart pre-check.
- `src/web`: the React UI.
- `data/stores.yaml`: the hand-maintained Store table (postage, free-postage thresholds, pickup, cart type). A monthly GitHub Action (`npm run check-stores`) opens an issue when a Store's shipping policy or location changes.

## Credits

Card data and images from [Scryfall](https://scryfall.com). Card images © Wizards of the Coast. MagicFinder is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

MagicFinder is not affiliated with Fetch TCG, MtgSingles or any Store.
