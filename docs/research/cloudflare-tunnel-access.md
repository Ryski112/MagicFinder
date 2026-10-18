# Cloudflare Tunnel + Access in front of MagicFinder

Research for "Can Cloudflare Tunnel + Access carry MagicFinder's live streams, and what does Access give the app?" (part of "Wayfinder: hosting MagicFinder on the NAS for friends"). Researched 2026-10-19 against MagicFinder at `9d217b1` (v0.2.1), Hono 4.13.13, @hono/node-server 2.1.5 and cloudflared 2026.10.1 (latest release, 15 Oct 2026).

Facts only. Where something is an inference or could not be confirmed from a primary source, it says so.

## Summary

- Both streams the app uses should arrive incrementally through the tunnel. cloudflared flushes on every write for any response with no `Content-Length`, with `Transfer-Encoding: chunked`, or with an SSE/gRPC/NDJSON content type. Both MagicFinder streams have no `Content-Length` and are chunked.
- The edge timeout that matters is the **Proxy Read Timeout: 125 s by default**, defined as the maximum time *between two reads* from the origin, not the total response time. The run events stream already sends a `ping` event after 15 s of quiet, so a 5 to 10 minute search does not hit it.
- One thing could change: the cart check stream is sent as `text/plain; charset=UTF-8`, a type Cloudflare compresses. Whether edge compression holds back a slow stream is not documented. The worst case is a frozen "checking card N" counter; the result still arrives.
- **Blocker for Docker:** the server listens only on `127.0.0.1` (`src/server/main.ts:81`). A cloudflared container on a Docker network cannot reach it unless it shares MagicFinder's network namespace.
- Access sends the signed JWT to the origin in `Cf-Access-Jwt-Assertion` (and in the `CF_Authorization` cookie), plus the user's email in `Cf-Access-Authenticated-User-Email`. You can check the JWT against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` and the application's AUD tag. Cloudflare's docs say an app reached through a Tunnel does not have to validate it. cloudflared can also validate it itself ("Protect with Access").
- A second app on the existing tunnel needs three things: a published application route (new hostname, then the MagicFinder service URL), a new self-hosted Access application for that hostname, and an Allow policy with the friends' emails and Google as the identity provider.

## 1. The two streams in the app

| Stream | Code | Format | Headers as sent (measured) |
|---|---|---|---|
| Run events (progress, Trade-off Ladder, re-plans) | `src/server/app.ts:112-140`, consumed by `EventSource` in `src/web/api.ts:59-65` | SSE via Hono `streamSSE` | `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`, `transfer-encoding: chunked`, no `content-length` |
| Cart pre-check ("Add all to cart") | `src/server/app.ts:166-188`, read with `fetch` + `getReader()` in `src/web/api.ts:32-55` | NDJSON via Hono `stream`, one line per card checked (about one per second) | `content-type: text/plain; charset=UTF-8` (Hono's default, the code sets none), `transfer-encoding: chunked`, no `content-length` |

The headers were measured by running both Hono helpers under @hono/node-server and printing the response headers. `streamSSE` sets its four headers in `node_modules/hono/dist/helper/streaming/sse.js`. `stream` sets none.

Heartbeat: the SSE loop waits up to 15 s for a new event (`src/server/app.ts:133`). If nothing came, it writes `event: ping` with empty data (`src/server/app.ts:136`). The client only handles unnamed messages (`es.onmessage`), so pings are ignored on the client, as intended. When the stream (re)connects it first replays the current progress and Ladder (`src/server/app.ts:122-123`). So an `EventSource` auto-reconnect after a drop picks up where it was.

The app has no compression middleware. Nothing in `src/server` compresses responses.

## 2. Does the tunnel buffer them?

**cloudflared (the connector on the NAS).** At tag 2026.10.1, `connection/connection.go` decides whether to flush every write to the edge:

```go
flushableContentTypes = []string{sseContentType, grpcContentType, sseJsonContentType} // text/event-stream, application/grpc, application/x-ndjson

func shouldFlush(headers http.Header) bool {
	if contentLength := headers.Get(contentLengthHeader); contentLength == "" {
		return true
	}
	if transferEncoding := ...; strings.Contains(transferEncoding, "chunked") {
		return true
	}
	// ...then the content-type prefix check
```

(Abridged from [cloudflared `connection/connection.go`](https://github.com/cloudflare/cloudflared/blob/2026.10.1/connection/connection.go).) A code comment explains the rule: responses without `Content-Length` or with chunked encoding "are streams, and therefore, should be flushed right away". Both MagicFinder streams meet the first two conditions, so the content type does not matter to cloudflared. The release notes date this rule to 2025-04-24: "TUN-9255: Improve flush on write conditions in http2 tunnel type to match what is done on the edge". The long-standing buffering bug report, [cloudflared#199 "Server-sent events are buffered"](https://github.com/cloudflare/cloudflared/issues/199), was closed on 2025-05-14 by a Cloudflare contributor with: "Server Sent Events have been fixed and this should now work, even if the right header isn't set". Older reports in that thread, from before the fix, said `application/x-ndjson` and `text/plain` chunked responses were buffered.

**Cloudflare's edge.** No developers.cloudflare.com page documents when the proxy buffers a streamed response. [Response buffering](https://developers.cloudflare.com/network/response-buffering/) (updated 23 Apr 2026) says nothing about SSE or streaming. The TUN-9255 note above says cloudflared now matches "what is done on the edge", which suggests the edge uses the same rules. That is an inference. Community threads report temporary edge regressions that Cloudflare staff fixed. Example: [SSE endpoint breaks after recent update](https://community.cloudflare.com/t/sse-endpoint-breaks-after-recent-update-cloudflare-buffers-text-event-stream-desp/810790) (secondary source).

**Compression.** [Content compression](https://developers.cloudflare.com/speed/optimization/content/compression/) (updated 17 Apr 2026):
- `text/event-stream` and `application/x-ndjson` are **not** on the list of types Cloudflare compresses. `text/plain` is.
- An origin can turn compression off for a response with `Cache-Control: no-transform`.
- The page does not say whether compression delays a streamed body.

So the run events stream is not compressed. The cart stream (`text/plain`) may be. If compression ever held the cart lines back, the dialog would show no per-card progress and then jump straight to the result. Nothing would fail. Two header-only changes would rule this out; both are options, not tested: send the cart stream as `application/x-ndjson`, and/or add `Cache-Control: no-transform`. Either would also be harmless on the desktop.

**`X-Accel-Buffering: no`** is an nginx header. Nothing in Cloudflare's docs or in cloudflared reads it. It only matters if an nginx (for example Synology's own reverse proxy) sits between cloudflared and MagicFinder. With cloudflared pointed straight at the container, it is not needed.

**Caching.** By default Cloudflare caches by file extension, and `/api/...` paths have none, so the streams and JSON are not cached. Static assets (`.js`, `.css`) are cached at the edge; Vite gives them hashed names. This is general knowledge of Cloudflare's default cache behaviour, not re-checked for this note.

## 3. Timeouts a 5 to 10 minute search could hit

From [Connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/):

| Limit | Value | Applies to | Effect on MagicFinder |
|---|---|---|---|
| Proxy Read Timeout | 125 s (configurable on Enterprise only, 1 to 6000 s) | Edge waiting on the origin. The API defines it as "Maximum time between two read operations from origin." | The run events stream writes at least every ~15 s, so it is never idle that long. Plain JSON calls are all quick. **Safe heartbeat: anything well under 125 s; the current 15 s has a wide margin.** |
| Proxy Write Timeout | 30 s | Sending the request to the origin | Requests are small. |
| Client connection idle (HTTP/1.1 keep-alive, HTTP/2) | 400 s | Browser to edge | Pings keep it busy. |
| HTTP/2 connection idle to origin | 900 s | Edge to origin | Not reached. |

Sources for the wording: the zone setting description in the [Cloudflare API (zone settings, edit)](https://developers.cloudflare.com/api/resources/zones/subresources/settings/methods/edit/) and [Error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/). The 524 page gives 125 s; older community posts and older docs quote 100 s, which has since been raised. The docs do not say separately that the Proxy Read Timeout applies to tunnel traffic. Tunnel hostnames are proxied through the same edge, so this note assumes it applies.

cloudflared's own origin settings ([Origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/)) are `connectTimeout` 30 s (TCP connect), `tlsTimeout` 10 s, `keepAliveTimeout` 1m30s (an idle pooled connection *may be discarded*) and `tcpKeepAlive` 30 s. None of them is a response or stream duration limit. `keepAliveTimeout` is about idle connections in the pool, not an open response.

The cart check stream writes a line per card (~1 s apart, paced by Store rate limits). A single card fetch would have to stall for over two minutes to reach 125 s.

## 4. What Access adds to each request

| Item | What it is | Source |
|---|---|---|
| `Cf-Access-Jwt-Assertion` request header | The application token (a JWT) Access sends to the origin. Cloudflare recommends validating this header over the cookie, because "the cookie is not guaranteed to be passed". | [Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) (updated 6 May 2026) |
| `CF_Authorization` cookie | The same token, set on the application's hostname (another one on the team domain for the global session). HttpOnly; SameSite configurable, default None. Lifetime: policy, then application, then 24 h default. | [Authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/) (updated 3 Aug 2026) |
| `Cf-Access-Authenticated-User-Email` request header | The user's email. Shown in Cloudflare's example requests; there is no dedicated reference page for it. On its own it proves nothing: "Validation of the header alone is not sufficient — the JWT and signature must be confirmed to avoid identity spoofing." | [Send SSO attributes… with Workers](https://developers.cloudflare.com/cloudflare-one/tutorials/extend-sso-with-workers/); [Application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/) (updated 25 Jun 2026) |

JWT payload fields ([Application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)): `aud` (the application's AUD tag), `email`, `exp`, `iat`, `nbf`, `iss` (the team domain URL), `sub` (user ID), `identity_nonce`, `type` (`app` or `org`), `country`.

**Validating the JWT** ([Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)):
- Public keys: `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/certs`. Match the token's `kid` against `public_certs`, not the legacy `public_cert`.
- Keys rotate every 6 weeks by default, and old keys stay valid 7 days. Fetch the endpoint instead of hard-coding a key.
- Check `aud` against the application's AUD tag: Zero Trust, Access controls, Applications, Configure, Additional settings, "Application Audience (AUD) Tag". Check `iss` against the team domain. Check the usual `exp` and `nbf`; the page does not mention them, but standard JWT libraries do it.
- In Node this is normally a JWKS fetch plus a signature check with a library such as `jose`. MagicFinder has no such dependency today.

**Session expiry and streams** ([Session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/), updated 14 Oct 2026):
- Global and application sessions default to 24 h. When the application token expires and the global session is still valid, Access silently issues a new one.
- The page warns that expired sessions "can silently block sub-requests" in single-page apps. Adding `X-Requested-With: XMLHttpRequest` to fetches makes Access answer 401 instead.
- `EventSource` cannot set request headers. The page does not say what happens to an open stream at expiry.
- *Inference, not verified:* an `EventSource` reconnect or a `fetch` made after expiry gets a redirect to the team domain, which the browser cannot follow cross-origin. Today `followRun` has no `onerror` handler (`src/web/api.ts:59-65`), and `call()` would show `Request failed (…)` (`src/web/api.ts:12-13`). With a 24 h default session this would be rare for a search; a reload fixes it.

## 5. Is checking the JWT in the app worth it? (options for the owner)

Cloudflare's position: "Unless your application is connected to Access through Cloudflare Tunnel, your application must validate the token to ensure the security of your origin." ([Application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)). In other words, with a Tunnel, validating is optional.

| Option | What it stops | What it leaves open | Cost |
|---|---|---|---|
| A. No validation; rely on the Access application in front of the hostname | Everyone on the Internet who is not on the allowlist, as long as the Access application covers the hostname. | (1) A misconfiguration that puts the hostname in front of the tunnel without Access: the Access app deleted, its domain mistyped, the policy switched to Bypass or Everyone, a second route or hostname pointed at the same service. The app is then public, with nothing to show it. (2) Anything that can reach the container's port directly: other containers on the same Docker network, or the LAN if a port is ever published or host networking is used. | None. |
| B. cloudflared validates ("Protect with Access" on the published application route; `originRequest.access: {required: true, teamName, audTag}` in a config file) | (1) above: a request reaching cloudflared without a valid token for that AUD is refused before it reaches the container. | (2) above: direct access on the Docker network or LAN skips cloudflared. A route that doesn't have the setting (for example a new one added later) is not covered. | A dashboard toggle plus the team name and AUD tag. No app changes. The Immich route on the same tunnel is unaffected (the setting is per route). |
| C. MagicFinder validates (hosted mode only) | (1) and (2): every request without a valid token is refused, whatever path it came by. | Only a stolen valid token (24 h by default), which no option covers. The app would also have to fetch the certs URL at runtime (outbound HTTPS from the container). | New code, a JWT library dependency, and two settings (team domain, AUD). Desktop untouched if it only runs in hosted mode. Tests need a fake JWKS. |

Facts that bear on (2): with Compose, containers on the same user-defined network can reach each other's ports without anything published. If cloudflared uses `network_mode: service:magicfinder` (sharing MagicFinder's network namespace), only cloudflared and MagicFinder share that loopback. The owner's existing cloudflared container may already sit on Immich's network or the host network. Which one it uses decides who else can reach MagicFinder directly, and that is not visible from here.

## 6. Adding MagicFinder to the existing tunnel and Access setup

All in the Cloudflare dashboard; no new tunnel or cloudflared container is needed.

1. **Access application first** (Cloudflare recommends this order, so the hostname is never briefly public). Zero Trust, Access controls, Applications, Create new application, Self-hosted, Add public hostname: pick the subdomain (e.g. `magicfinder.<domain>`) on the zone already used for Immich. Steps from [Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) (updated 17 Apr 2026).
   - Policy: Access is deny by default, so add an **Allow** policy with an *Include: Emails* rule listing the friends' Google addresses. If the Immich allowlist is a reusable policy (or an email list), it can be attached to the new app as well.
   - Identity providers: Google, which is already configured for the Immich app. With only one provider, "Apply instant authentication" skips the Access chooser page.
   - Session duration: default 24 h; adjustable per application or policy.
   - Copy the AUD tag if option B or C will be used.
2. **Published application route on the existing tunnel.** Networking, Tunnels, (the NAS tunnel), Routes, Add route, Published application: same hostname, then a service URL that reaches the MagicFinder container from cloudflared, e.g. `http://magicfinder:5180` on a shared Docker network. Cloudflare creates the proxied CNAME to `<tunnel-id>.cfargotunnel.com` automatically ([Create a tunnel (dashboard)](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)). Optional: "Protect with Access" under the route's additional application settings (option B).
3. **Docker networking.** cloudflared's container must be able to reach MagicFinder's port: put both on one Compose network, or run cloudflared with `network_mode: service:magicfinder`. See the bind address issue below.

## 7. What in the app would break or behave oddly behind it

| Where | What | Behind Tunnel + Access in Docker |
|---|---|---|
| `src/server/main.ts:81` | `serve({ … hostname: '127.0.0.1' })` | **Breaks.** A cloudflared container on a Docker network connects to the container's network address, not its loopback, so it gets "connection refused". Works only if cloudflared shares MagicFinder's network namespace (`network_mode: service:…`). Hosted mode would need to listen on `0.0.0.0` (or a configurable host). |
| `src/server/main.ts:28-37`, `src/server/instance.ts:7-32` | Second-launch handover: probes ports from 5180 on `127.0.0.1` and calls `http://127.0.0.1:<port>/api/status`; may pick a port other than 5180 | Skipped entirely when `MAGICFINDER_PORT` is set (`main.ts:29`). Without it, the handover runs inside the container, where only one process runs, so it picks 5180 unless that port is taken. It would still pick another port if 5180 were in use, which would silently break the tunnel's service URL. Setting `MAGICFINDER_PORT` makes the port fixed. |
| `src/server/main.ts:33`, `:74-79`, `:85` | Opens a browser at `http://localhost:<port>` with `xdg-open` | Harmless in a container: `spawn` errors are swallowed (`main.ts:78`), and `MAGICFINDER_NO_OPEN` turns it off (`main.ts:75`). Log lines print `http://localhost:…`, which is cosmetic. |
| `src/web/api.ts` (all calls), `src/web/api.ts:60` | Relative URLs (`/api/...`) for every call and for `EventSource` | Fine. Same origin as the page, so the `CF_Authorization` cookie goes along and there is no CORS. |
| `vite.config.ts:11` | `/api` proxy to `http://localhost:${SERVER_PORT}` | Dev server only; not in the built image. |
| `src/web/components/CartDialog.tsx:16-25`, `:126-127` | "Add all to cart" opens a blank tab during the click (`window.open('', '_blank')`), writes a message into it, then sets `tab.location.href` to the Store's cart permalink once the check finishes | Fine. The blank tab is same-origin with the page and is never loaded from the server, so Access is not involved. The final navigation goes to the Store's own site. The pop-up hint shows `window.location.host` (`CartDialog.tsx:46`), which becomes the public hostname. Pop-up permission is per origin, so friends grant it once for the new hostname. |
| `src/server/app.ts:177-178` | Cart stream has no explicit `Content-Type` (goes out as `text/plain`) | Streams through cloudflared. May be compressed at the edge; see section 2. |
| `src/web/api.ts:59-65` | `EventSource` without `onerror` | A lost stream (network blip, Access expiry) is not surfaced. Auto-reconnect covers blips (the server replays state on reconnect). Access expiry is covered in section 4. |
| `src/server/app.ts:35-42` | `/api/status` returns version and the update notice | Works through the tunnel. In hosted mode, the "new version available" notice would show to friends, who cannot act on it. That is a hosted-mode product question for another ticket, not a tunnel issue. |

Nothing in the app reads `Host`, `X-Forwarded-*`, `Origin` or the client IP, and nothing builds absolute URLs to itself. The Cloudflare-side hostname and HTTPS are therefore transparent to it.

## Not verified

- Edge (not cloudflared) buffering rules for streamed responses: no primary doc; inferred from the TUN-9255 release note and a closed bug report.
- Whether edge compression of a `text/plain` chunked response delays it.
- That the 125 s Proxy Read Timeout applies to tunnel traffic exactly as to other proxied origins (assumed; not stated for tunnels).
- What an open SSE stream, or an `EventSource` reconnect, does when the Access session expires.
- Nothing was tested end to end through a real tunnel; header behaviour was measured only locally.
