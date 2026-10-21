# Hosting MagicFinder on the NAS for friends

How the owner runs MagicFinder's **hosted mode** on a Synology NAS so that friends can use it at `https://magicfinder.<your-domain>`, signed in with Google through Cloudflare Access. It is the build side of [Wayfinder: hosting MagicFinder on the NAS for friends](https://github.com/Ryski112/MagicFinder/issues/33). Every choice below was made in that map's tickets.

Nothing here changes the desktop download. Hosted mode only switches on inside the Docker image.

## What friends get

- **Signing in:** Google sign-in through Cloudflare Access, for the email addresses on the allowlist only. MagicFinder itself has no accounts.
- **Their own search:** each browser has its own search. A new search in one tab replaces the search in that browser's other tabs, never anyone else's. Up to 10 searches run side by side; any more wait in a queue ("Waiting for N searches ahead of you").
- **Sharing the Sources:** when friends use the same Source at once, Source Status says so, e.g. *"MtgSingles: shared with 1 other search · about 6 min left"*. It shows a count only, never what anyone searched for. Searches made in the last hour are reused for everyone.
- **Their own settings:** settings are kept in each friend's browser (so a phone and a PC can differ). A new friend is asked for their city and whether they're rural before their first search.
- **When the connection drops:** if the connection drops or their Access session has expired, a *"Lost connection… Reload"* banner appears. After the reload they're back on their search, if it's less than 30 minutes old.
- **Not in hosted mode:** no "new version" notice and no "Clear saved searches" button.

## 1. Once, on GitHub: make the image public

The **Docker image** workflow (`.github/workflows/docker.yml`) runs on every release tag, the same `vX.Y.Z` tag that publishes the desktop downloads. It pushes `ghcr.io/ryski112/magicfinder` as `X.Y.Z`, `X.Y` and `latest`, for both `amd64` and `arm64`, so it runs on either kind of Synology.

After the **first** release that includes it:

1. GitHub → your profile → **Packages** → **magicfinder** → **Package settings**.
2. **Danger Zone → Change visibility → Public.** The repository is public anyway. A public image lets the NAS pull it without a token. GitHub doesn't let a public package go private again.

To check that the image builds without releasing: Actions → **Docker image** → **Run workflow**. It builds both architectures, boots the image and checks `/api/status`, but pushes nothing.

## 2. On the NAS: the data folder

1. **File Station:** create `docker/magicfinder/data` on volume 1, so the full path is `/volume1/docker/magicfinder/data`. Keep it on the NAS's own volume, not an SMB/NFS mount, because the SQLite files need local file locking.
2. Find the uid and gid of the DSM user that owns that folder. Over SSH, run `id <your-dsm-user>`; it prints something like `uid=1026(<user>) gid=100(users)`. You'll put these in `user:` below.

The data folder holds:

| File | What it is |
|---|---|
| `catalogue.sqlite` | The Scryfall card list (about 54 MB). It downloads itself on first start, then refreshes daily. |
| `search-cache.sqlite` | Searches from the last day, shared by everyone. Fresh for 1 hour. |
| `settings.json` | **Server-only** settings: the staples basket, the rung time limit (`rungTimeLimitS`) and Source health. Friends' own settings live in their browsers. |
| `cardkingdom-prices.json`, `exchange-rate.json` | The Card Kingdom compare's price list and exchange rate. |
| `au-stores.json` | The weekly Australian Store check: which ship to NZ, and their postage. Delete it to go back to the list the image shipped with; the next check runs within the hour. |

Nothing here needs a backup. Every file rebuilds itself if it's deleted.

## 3. On the NAS: the Container Manager project

Container Manager → **Project** → **Create**:

- **Project name:** `magicfinder`
- **Path:** `/volume1/docker/magicfinder`
- **Source:** Create docker-compose.yml, and paste:

```yaml
# /volume1/docker/magicfinder/compose.yaml
services:
  magicfinder:
    image: ghcr.io/ryski112/magicfinder:latest
    container_name: magicfinder
    restart: unless-stopped
    user: "1026:100"            # uid:gid from `id <your-dsm-user>` (step 2)
    volumes:
      - /volume1/docker/magicfinder/data:/data
    ports:
      - "5180:5180"             # the tunnel route reaches http://<nas-ip>:5180
    mem_limit: 3g               # a guard rail, not a fit: a search peaks around 0.4–1.3 GB
    # environment:
    #   MAGICFINDER_SOLVERS: "2"  # only if the NAS's CPU turns out tight (unset = one fewer than the NAS's cores, at most 4)
```

Skip the web portal (Web Station) step, then **Done**. Container Manager pulls the image and starts it.

The image already sets everything else: `MAGICFINDER_HOSTED=1`, `MAGICFINDER_HOST=0.0.0.0`, `MAGICFINDER_PORT=5180`, `MAGICFINDER_DATA_DIR=/data` and `MAGICFINDER_NO_OPEN=1`.

**Check it on the LAN:** open `http://<nas-ip>:5180`. The first start downloads the card list, which takes a minute or two, and the page shows its progress. The container log (Container Manager → **Container** → magicfinder → **Log**) should say:

```
MagicFinder X.Y.Z is running at http://localhost:5180 (hosted mode, listening on 0.0.0.0)
```

Anyone on the home network can use MagicFinder at that address without signing in. That's intended: Access guards the public hostname, not the home network.

## 4. In Cloudflare: the Access application (do this before the route)

Create the Access application first, so the hostname is never public, even for a moment.

Cloudflare dashboard → **Zero Trust** → **Access controls** → **Applications** → **Create new application** → **Self-hosted**:

1. **Public hostname:** subdomain `magicfinder`, domain `<your-domain>`.
2. **Policy:** add an **Allow** policy with **Include → Emails** listing the friends' Google addresses. If another app's allowlist is a reusable policy or email list, you can attach that instead.
3. **Login methods:** Google. With only one login method, turn on **Apply instant authentication** so friends skip the chooser page.
4. **Session duration:** **1 week** (`168h`). A friend then signs in about once a week, and an expired session mid-search is rare. When it does happen, the Lost connection banner covers it.
5. Save. Then open the application's **Additional settings** and copy the **Application Audience (AUD) Tag**. Step 5 needs it.

## 5. In Cloudflare: the route on your tunnel

**Zero Trust** → **Networks** → **Tunnels** → *your tunnel* → **Routes** (or **Public hostnames**) → **Add route** → **Published application**:

1. **Hostname:** `magicfinder.<your-domain>`.
2. **Service:** `HTTP`, URL `<nas-ip>:5180`, so the service URL is `http://<nas-ip>:5180`. Pointing at the NAS's LAN address means it doesn't matter which Docker network cloudflared uses.
3. Under **Additional application settings → Access**, turn on **Protect with Access**. Enter your team name and the AUD tag from step 4. cloudflared then refuses any request without a valid Access token for this application, even if the Access application were later deleted or misconfigured. MagicFinder itself doesn't check the token.
4. Save. Cloudflare creates the DNS record for the hostname.

**Check it:** open `https://magicfinder.<your-domain>` in a private window. Google sign-in should appear. Sign in with an allowlisted address, run a small search, and check that progress updates live. An address that isn't on the list should be refused.

## Updating to a new version

You cut the releases, so you know when there's a new one. There's no in-app notice in hosted mode. Once the **Docker image** workflow has finished for the new tag:

Container Manager → **Project** → magicfinder → **Action → Stop**, then **Action → Build**. Build pulls `:latest` again and recreates the container. The data folder stays. There are a few seconds of downtime. Friends with a search open see the Lost connection banner and reload.

To stay on a minor version (`0.3.x`), use `image: ghcr.io/ryski112/magicfinder:0.3` in the compose file instead of `:latest`.

## Owner tasks

MagicFinder never recognises the owner; there are no admin pages. Everything is done through the data folder, the compose file and the container log.

| Task | How |
|---|---|
| Change the staples basket or the rung time limit | Stop the project, edit `settings.json` in the data folder, start it again. MagicFinder rewrites the file while it runs, so edits made while it's running are lost. |
| Throw away all saved searches | Stop the project, delete `search-cache.sqlite`, start it again. A restart alone doesn't clear the cache. |
| See how hard the Sources are being used | Container log. Each NZ day ends with a line like `Source requests on 2026-10-21: MtgSingles 412, Fetch TCG 230`, and stopping the container prints the count so far. There's no daily ceiling. |
| A Source keeps blocking | Source Status shows it to everyone. Any friend can press **Try again now**, which clears the block for everyone. Requests stay paced, and the block comes straight back if the Source still refuses. Never route Source traffic through a VPN or proxy to get round a block. |
| Fix a Store's postage for everyone | Fix the Store in `data/stores.yaml` in the repository and release. Friends' postage overrides only affect their own browsers. |
| Add or remove a friend | The Access application's Allow policy (step 4). |
| CPU too busy (other apps or MagicFinder slow) | Add `MAGICFINDER_SOLVERS: "2"` (or `"1"`) under `environment:` in the compose file, then Stop → Build. Fewer solvers make planning slower but lighter. |

## Still to check on the real NAS

These couldn't be checked before the image existed (see the map's Out of scope):

- planning speed on the NAS's CPU, and CPU use next to its other apps (`MAGICFINDER_SOLVERS` is the knob),
- that Container Manager's Stop → Build really pulls the new `:latest`,
- that an expired Access session, through the real tunnel, shows the Lost connection banner.
