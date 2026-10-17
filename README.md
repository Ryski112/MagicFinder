# MagicFinder

Finds the cheapest way to buy a list of Magic: The Gathering singles from New Zealand Stores, postage included. It searches **Fetch TCG** and **MtgSingles**, then shows a **Trade-off Ladder**: the cheapest Plan using 1, 2, 3… Stores, so you can decide how many separate orders a saving is worth.

It runs on your own computer and opens in your browser. Nothing is hosted anywhere.

## Install

No setup needed: download, extract, double-click. MagicFinder runs on your computer and opens in your normal web browser.

**Windows**

1. Download [`MagicFinder-windows-x64.zip`](https://github.com/Ryski112/MagicFinder/releases/latest/download/MagicFinder-windows-x64.zip).
2. Right-click the zip and choose **Extract All**, then open the extracted folder. (Running it from inside the zip doesn't work.)
3. Double-click **`MagicFinder.cmd`**.
   - Windows may ask "Open File – Security Warning" ("The publisher could not be verified"): click **Run**.
   - If it says **"Windows protected your PC"** instead, click **More info**, then **Run anyway**.
   - This happens because MagicFinder isn't code-signed. You'll only be asked the first time.
4. A black window titled **"MagicFinder – keep this open"** appears and your browser opens MagicFinder. Leave that window open while you use it; **close it to stop MagicFinder**.

**Linux**

1. Download [`MagicFinder-linux-x64.tar.xz`](https://github.com/Ryski112/MagicFinder/releases/latest/download/MagicFinder-linux-x64.tar.xz) and extract it (`tar -xJf MagicFinder-linux-x64.tar.xz`, or right-click → Extract).
2. In a terminal, run `./MagicFinder.sh` from the `MagicFinder` folder (or right-click it → **Run as a Program**, where your file manager offers that). Your browser opens MagicFinder.
3. Keep the terminal open while you use it; press **Ctrl+C** or close it to stop.

**First run:** MagicFinder downloads the card list from Scryfall (about 80 MB, refreshed once a day after that). The Want List screen shows progress.

**Already running?** Double-clicking it again just opens the copy that's running.

**Updating:** when a new version is out, MagicFinder shows a notice with a **Download** link. Download it, extract it, and use it in place of the old folder. Your settings and card list are kept: they live in your user data folder, not in the MagicFinder folder.

## Run from source

For developers, or to run the latest code. You need **Node.js 22.13 or newer** ([nodejs.org](https://nodejs.org), the "LTS" download) and **git**.

```bash
git clone https://github.com/Ryski112/MagicFinder.git
cd MagicFinder
npm install
npm start
```

`npm start` builds the app, starts it, and opens `http://localhost:5180` in your browser. Leave the terminal open while you use it; close it (or press Ctrl+C) to stop. After cloning, `start.bat` (Windows) or `./start.sh` (macOS/Linux) does the same in one double-click, installing on the first run.

A source copy shares the downloaded version's settings and card list. With `MAGICFINDER_PORT` set (or `npm run dev`) it runs beside a downloaded copy instead of handing over to it.

## Using it

1. **Want List.** Paste a list (Archidekt, Moxfield, Arena, MTGO or plain `4 Lightning Bolt` lines), paste an Archidekt deck link and press Import, or add cards by name with the search bar (Enter shows a card's printings; pick one to buy only that printing). The review list shows what was recognised; untick anything you don't want. Basic lands and the maybeboard are left out by default. MagicFinder buys the cheapest printing of each card unless a line is locked to one (**🔒 only buy …**).
2. **Search.** MagicFinder asks each Source about every card, politely (about one request a second per Source). Results are reused for an hour.
3. **Choose a Plan.** Pick a rung of the Ladder. Store Listings MagicFinder couldn't match to a card are listed under **Show them**, in case one is a card you want. Each Store section lists the cards, prices, postage and a link to every Listing.
   - **Other Printings** shows every version in stock with its price. **Only buy this one** locks the line to that exact Printing and re-plans.
   - **I'll pick up** (Stores in your pickup city) removes their postage and re-plans. MagicFinder remembers it.
   - **Add all to cart** (most Stores) opens a new tab straight away, checks stock and prices, then turns that tab into the Store's cart with your cards in it (anything sold out is listed back in MagicFinder). It replaces anything already in that Store's cart. You check out yourself. Fetch TCG has one cart for all its sellers, so it gets an "Open Fetch Listings" button instead.
   - Postage marked **est.** is a guess ($7 by default) because the Store doesn't publish its rates. Click it to enter what that Store really charges you.

**Settings** (⚙): postage type, pickup city, rural address, minimum condition (Lightly Played by default), foils, using the Printings from your list, basic lands, which Sources to search, the default postage guess, and light/dark mode.

When a Source stops answering, MagicFinder carries on with the other one, says which cards were only searched once, uses prices up to a day old if it has them, and waits 30 minutes before asking that Source again (or press **Try again now**).

## Where things are kept

Settings, the card list and the search cache live in your user data folder:

- Windows: `%APPDATA%\MagicFinder`
- macOS: `~/Library/Application Support/MagicFinder`
- Linux: `~/.local/share/magicfinder`

Set `MAGICFINDER_DATA_DIR` to use another folder or `MAGICFINDER_NO_OPEN=1` to stop it opening a browser tab.

## For developers

```bash
npm run dev        # API server + Vite with hot reload
npm test           # unit tests (recorded fixtures; never calls the live Sources)
npm run typecheck
npm run package    # the Windows zip and Linux tarball, into release/ (see Releasing)
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

## Releasing

1. Set `version` in `package.json` (e.g. `0.2.0`) and commit.
2. Tag it and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The **Release** Action builds both downloads with the official Node.js 24 runtime, smoke-tests each on its own OS (Windows and Linux), and publishes a GitHub Release with them attached. Running the Action by hand builds and tests without publishing.

Friends can only download releases once the repository is public.

## Credits

Card data and images from [Scryfall](https://scryfall.com). Card images © Wizards of the Coast. MagicFinder is unofficial Fan Content permitted under the [Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy). Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

MagicFinder is not affiliated with Fetch TCG, MtgSingles or any Store.
