# Moxfield deck import from a link

Research for issue #19, which asks whether a `moxfield.com/decks/<publicId>` link can become a **Want List**. It follows up on issue #4 ([want-list-import.md](https://github.com/Ryski112/MagicFinder/blob/research/want-list-import/docs/research/want-list-import.md)), which found the Moxfield API blocked by Cloudflare.

Researched 2026-10-17. Everything was read-only: no accounts, no logins, no form submissions. The live probes were about ten requests in total, all for one public deck, `rA9vj8QkV02CbDOISXOFMw` ("Ureni of the Unwritten | Precon Decklist"), plus one made-up id.

## TL;DR

1. **It works technically, server-side, today.** `GET https://api2.moxfield.com/v3/decks/all/{publicId}` returns the full deck as JSON to a plain Node `fetch`, as long as the request sends MagicFinder's honest `User-Agent`. No auth or cookies are needed. The `v2` path works too.
2. **The hidden Chrome doesn't help, it's blocked.** Headless Chrome gets Cloudflare's 403 "Attention Required!" on `moxfield.com` itself, and a fetch made from that page fails. Node `fetch` sending a *browser-like* `User-Agent` also gets 403. Cloudflare blocks clients that claim to be a browser without being one, and lets honestly identified clients through.
3. **The policy says no unless Moxfield approves.** The Terms of Service (effective 9 July 2026), §4, forbid using "any robot, spider or other automatic device, process or means to access the Site … except as expressly approved by Moxfield". `api2.moxfield.com/robots.txt` reads `Disallow: /`. Moxfield publishes no official or documented API, and none was found.
4. **Recommendation:** don't ship Moxfield URL import without written approval from Moxfield. Ask at support@moxfield.com. Until then, Moxfield users paste an export, which already works. If approval comes, the implementation is a small server-side twin of `src/server/archidekt.ts` (sketch below).

## 1. Endpoints

| Request | Client | Result |
|---|---|---|
| `GET api2.moxfield.com/v3/decks/all/{publicId}` | Node 22 `fetch`, `User-Agent: MagicFinder/0.1 (personal price finder; https://github.com/Ryski112/MagicFinder)` | **200**, `application/json` |
| `GET api2.moxfield.com/v2/decks/all/{publicId}` | same | **200**, `application/json`, older shape (§2) |
| both of the above | Node `fetch`, `User-Agent: Mozilla/5.0 … Chrome/141 …` | **403**, Cloudflare HTML block page |
| `GET moxfield.com/` | headless Chromium 154 via `playwright-core`, set up as in `src/sources/browser.ts` | **403**, page title "Attention Required! \| Cloudflare" |
| in-page `fetch(api2…/v3/decks/all/{id}, {credentials:'omit'})` | that same page | `TypeError: Failed to fetch` |
| `GET api2.moxfield.com/v3/decks/all/ZZZZZZZZZZZZZZZZZZZZZZ` | Node, honest UA | **404**, RFC 9110 problem JSON `{"title":"Not Found","status":404,…}` |
| `GET api2.moxfield.com/v2/decks/all/{publicId}/download?exportId={exportId}&arenaOnly=false` | Node, honest UA | **200**, `text/plain` |

- The responses carry `cache-control: no-store` and `cf-cache-status: BYPASS`. They had no rate-limit headers and no CORS headers, so the browser would block a call made directly from MagicFinder's front end. It would have to be proxied, as Archidekt already is.
- The deck page's own JS bundle calls these same paths: `/v3/decks/all/`, `/v2/decks/all/` and `/v3/decks/all/alt/`. The "Download deck list (.txt)" menu links to `…/v2/decks/all/{publicId}/download?exportId=…`. Source: `assets.moxfield.net/assets/assets/moxfield.a8b163a5b8baeade1df0.js` and chunk `5556.ed7da15d0b296cbc0d4d.js`, both read as text.
- The `.txt` download is the bare `1 Card Name` format, with no set, collector number or finish. The JSON is the better source, and it supplies the `exportId` the download needs anyway.
- **This differs from #4.** #4 recorded a 403 for non-browser clients. Today an honestly identified client gets 200. Either Cloudflare's rules have changed or #4 sent a browser-like UA; this research can't tell which. Either way the rules are Moxfield's to change at any time, so a 403 must be handled as **Blocked**.

## 2. JSON shape (v3)

Top level: `id`, `name`, `format`, `visibility` (`"public"` for the sample), `publicId`, `publicUrl`, `exportId`, `lastUpdatedAtUtc`, `authors[]`, `main` (the featured card) and **`boards`**, among others.

`boards` is an object of board name to `{ count, cards }`. The sample has these keys: `mainboard`, `sideboard`, `maybeboard`, `commanders`, `companions`, `signatureSpells`, `attractions`, `stickers`, `contraptions`, `planes`, `schemes`, `tokens`. `cards` maps a per-deck entry id, such as `"kaN49"`, to an entry:

```json
{ "quantity": 3, "boardType": "mainboard", "finish": "nonFoil", "isFoil": false,
  "isAlter": false, "isProxy": false,
  "card": { "name": "Island", "set": "j25", "cn": "86",
            "scryfall_id": "0e443748-edf1-4499-9507-3649dd57ee95",
            "layout": "normal", "foil": …, "nonfoil": …, "etched": …, "defaultFinish": …, "prices": {…}, … } }
```

- **Quantity** is `entry.quantity`. The sample's `mainboard.count` (99) equals the sum of its quantities, spread over 88 entries.
- **Name** is `card.name`. Two-faced cards use the full `"A // B"` spelling, for example `"Whirlwing Stormbrood // Dynamic Soar"`, so the existing front-face matching applies.
- **Set** is `card.set`, a lowercase Scryfall code (`tdc`, `pw23`). **Collector number** is `card.cn`, a string that can include non-digits (`"149s"`). `card.scryfall_id` is also present, which is a better identifier than set+cn.
- **Finish** is `entry.finish`. Observed values were `"nonFoil"` (111) and `"foil"` (2). An etched value presumably exists, since `card.etched` and `card.defaultFinish` are in the schema, but no example was seen: **unverified**.
- **Board to section** mapping for the existing paste parser: `commanders` → Commander, `companions` → Companion, `mainboard` → Mainboard, `sideboard` → Sideboard, `maybeboard` → Maybeboard (excluded by default, as in #4). `signatureSpells` (Oathbreaker) belongs with the deck, either Commander or Mainboard. `attractions`, `stickers` and `contraptions` are real cards someone might buy, so the Sideboard is the closest fit (a product call). `planes` and `schemes` are oversized cards, and `tokens` aren't singles, so skip those three.
- **v2** has the same entries, but the boards sit flat at the top level (`mainboard`, `commanders`, `sideboard` …, each with a `…Count`) instead of under `boards`. Prefer v3, which is what the current site uses.

## 3. Private and unlisted decks

- A made-up id returns **404** with problem JSON (tested).
- Moxfield decks can be public, unlisted or private. An unlisted deck is reached by knowing its `publicId`, so the same anonymous request should return it. A private deck should return 404 or 403 to an anonymous caller. **Neither was tested**, because no unlisted or private deck id was available and no account was used. Handle it the way `importArchidekt` does: on 403 or 404, say "private or doesn't exist, paste an export instead". The one exception is a 403 with an HTML (Cloudflare) body, which means Blocked.

## 4. Terms, robots.txt and official access

- **Terms of Service**, effective 9 July 2026, served at `moxfield.com/help/terms` (the text is bundled in chunk `8207.89068c3533b2f7b128e0.js`):
  - §4c "Limited License": you may use the Site "for your non-commercial personal use".
  - The same section says you may not "use any robot, spider or other automatic device, process or means to access the Site for any purpose, including monitoring or copying any information or material on the Site, except as expressly approved by Moxfield". You also may not "use any manual process to monitor or copy any of the material on the Site … without Moxfield's prior, written consent".
- **robots.txt**: `moxfield.com/robots.txt` disallows only `/search/*`, `/account/*`, `/collection/*`, `/binders/*` and `/user/admin.html`. `api2.moxfield.com/robots.txt` disallows everything: `User-agent: *` / `Disallow: /`.
- **Official API**: none found. There is no developer portal or API documentation, and the API paths appear only inside the site's own bundle. Community wrappers exist, such as [MarioMH8/moxfield-api](https://github.com/MarioMH8/moxfield-api), [Aleqsd/moxfield-api](https://github.com/Aleqsd/moxfield-api) and mtgban's [moxfield package](https://pkg.go.dev/github.com/mtgban/mtgban-website/moxfield). [One project's issue](https://github.com/KoalaTrapLord/commander-ai-lab/issues/35) says Moxfield's FAQ states there is no official public API. The FAQ (`/help/faq`) is loaded from a CMS and couldn't be read, so that claim is **secondary and unverified**. The Privacy Policy (same effective date) names `support@moxfield.com` as the contact address and says the site uses Cloudflare bot protection.
- **Interpretation:** a single request the buyer triggers, for a deck they choose, is about as light as automated access gets. It also fits "non-commercial personal use". But the clause covers any "automatic … means", and the API's robots.txt opts out entirely. The only clean path is express approval from Moxfield.

## 5. Recommendation

1. **Now:** keep Moxfield on the paste path. #4 already showed that the paste parser handles Moxfield's exports. When someone pastes a `moxfield.com/decks/…` link, the UI should say to use Moxfield's **Export** and paste the result.
2. **Ask Moxfield** at support@moxfield.com for express approval. Describe MagicFinder as a personal, non-commercial, locally run tool that sends one request per deck when the user clicks Import, with an identifying `User-Agent` and no caching. Keep the written reply on record.
3. **If approved**, add `src/server/moxfield.ts` next to `archidekt.ts`:
   - Parse `/moxfield\.com\/decks\/([A-Za-z0-9_-]{10,})/`.
   - Make one server-side `fetch` of `https://api2.moxfield.com/v3/decks/all/{id}` with `USER_AGENT` and `Accept: application/json`. Use plain Node, **not** the hidden Chrome, and **don't** send a browser UA.
   - Map `boards` to section-headed paste text (§2), writing each line as `{quantity}x {name} ({SET}) {cn}`, plus `*F*` for foil or `*E*` for etched, then reuse the existing parser.
   - Treat 404 as private or missing, 403 with an HTML body as Blocked, and anything else that fails as Down.
4. **Don't** try to defeat the Cloudflare check: no headful or stealth Chrome, no spoofed UA. It conflicts with the Terms and with MagicFinder's existing rule of no stealth and no challenge-solving (`src/sources/mtgSingles.ts`).
