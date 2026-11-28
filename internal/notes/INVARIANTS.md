# Ogygia invariants

Why certain designs exist — and what breaks if you “simplify” them.
Security and performance audits should read this before changing trust boundaries.

Every section ends with an `**Enforced by:**` line: the rules (`rule_…`), lint rules (`ogygia/…`),
tests and checks (`path` or `path > name`) that fail when the invariant breaks. CI fails a section
with no line, or a line naming something that does not exist (`internal/checks/invariants.ts`).

---

## HOLE-TRUST — signed same-origin HTML for deferred regions

**What:** The runtime fetches a capability URL and inserts the HTML it answered. Every string becomes DOM in one module, `packages/core/src/runtime/html-sink.ts`: region HTML is parsed with `setHTMLUnsafe` into a template of a document with no browsing context (inert: nothing in it is built or run until it is inserted; declarative shadow roots attach), then grafted or swapped in (`replaceChildren`); a fetched page is parsed with `DOMParser`. The sink takes only a `VerifiedHtml`, and only its vouchers make one, each named by what it checked (a same-origin endpoint whose answer stayed same-origin, a page fetch that landed on this origin, HTML the page itself holds, an answer of the app's own remote transport). Scripts in that HTML do **not** run; event-handler attributes would.

**Why:** Deferred / SWR regions are MPA-equivalent: the HTML is produced by _our_ SSR under a verified HMAC. Trust root is the **server MAC**, not the client.

**Do not:**

- Pipe hole HTML through a generic sanitizer (DOMPurify etc.) without allowing `ogygia-region` and lake structure — it silently breaks holes.
- Treat absolute `endpoint` URLs as a primary XSS bug; mint always emits a **path-only** URL. The client same-origin check is defense-in-depth for prior HTML injection.

**Client check:** `is_allowed_region_endpoint` + final `response.url` origin, for a hole's own fetch and for a batch of holes alike; a soft refresh merges only a page that landed on this origin. Abort in-flight fetches on disconnect.

**Enforced by:** `ogygia/html-sink`, `internal/lint/html-sink.test.ts > package source that turns a string into DOM, or casts to VerifiedHtml, is refused`, `packages/compiler/test/audit-fixes.test.ts > allows same-origin relative and absolute; rejects cross-origin`, `packages/core/test/browser/batch-same-origin.test.ts`, `packages/core/test/browser/soft-refresh-foreign-landing.test.ts`

---

## CODE-ORIGINS — island code loads from the app's own origins only

**What:** The runtime imports island code only from the page's origin, its own (Kit's `paths.assets`), and the origins the server writes on the runtime's script (`data-og-origins`: plugins add theirs through the `codeOrigins` shared hook, federation its peers'; a request adds what its render learned in `facts.codeOrigins`, federation the own runtime origin of each peer fragment it used, taken only from an answer of that peer's configured origins). The server writes it once, at head time (`runtime_first`). It reads them once, from the head's first runtime script (the server's, placed before any markup; no attribute there means no extra origin), at boot. Anything else is refused (`island_code_refused`). A region's `src` is kept as its identity's location only when it is the same island's built file (`og-region.<iid>.<hash>.js`) on the identity's origin. The restorer never sets an `on*`, `srcdoc` or script-URL attribute from `og-r`.

**Why:** `entry`, `src` and `og-r` are markup. Markup that cannot run script by itself (a rich-text field, a sanitizer that keeps custom elements and unknown attributes) must not become script through ogygia, and under `'strict-dynamic'` the runtime's `import()` is trusted, so a CSP would not stop it. One injected `src` must not re-point the code of every region with that identity.

**Do not:**

- Call `import_file` with anything but a `CodeUrl` (only `runtime/code-origins.ts` makes one; the type stops the rest).
- Re-read `data-og-origins` after boot, or from a script outside the head (a later one would widen the list).
- Accept a location that is not the same island's file, even on the page's own origin (an uploaded `.js` is on it too).

**Enforced by:** `packages/core/test/browser/code-origins.test.ts`, `packages/core/test/code-origins.test.ts`, `packages/federation/test/code-origins.test.ts`, `packages/rewrite/test/browser/restore.test.ts` (the og-r case)

---

## CAPABILITY-URL — bearer token in the query string

**What:** `?id=&props=&exp=&sig=` is a time-limited bearer capability. MAC integrity ≠ confidentiality.

**Why:** Stateless edge-friendly rendering without a prop store. Props must survive the wire for defer/SWR.

**Defaults:**

| Knob                | Default        | Why                                                                                     |
| ------------------- | -------------- | --------------------------------------------------------------------------------------- |
| TTL (`regions.ttl`) | **3600s** (1h) | Harvested URLs age out; long enough for typical tabs. Clamp `[60, 86400]`.              |
| `sessionCookie`     | **off**        | Prerender / shared CDN HTML cannot bind a request cookie. Opt in for personalized HTML. |

**Do not:**

- Force `sessionCookie` on by default (breaks prerendered defer holes).
- Put secrets in defer props and expect the URL to hide them — use Referrer-Policy (`no-referrer` on region responses) and keep secrets out of captured props.
- Move props into `localStorage` “for confidentiality” — XSS then reads all of them.

**Enforced by:** `packages/core/test/region-capability.test.ts > a v3 capability with its expiry or props changed is refused`, `packages/core/test/capability-expiry.test.ts > is always valid for more than ttl/2 and at most ttl`

---

## PAGE-SEED — `application/ogygia-page` on `csr=false`

**What:** `ogygiaHandle` injects a document-level devalue snapshot of `page` (including `data` / `form` / `error` when serializable).

**Why:** Islands use `$app/state` / `$app/stores` shims. Without a seed, `page.data` is empty under `csr=false` (Kit only serializes it when `csr=true`).

**Invariant:** Same **client visibility** contract as Kit `csr=true`. Stock `csr=false` without ogygia keeps load data server-only — enabling ogygia changes that. Document it; do not treat it as an accidental leak.

**Do not:** Strip `data` by default without an opt-in API for islands that read `page.data` (would break real apps).

**Enforced by:** `packages/compiler/test/audit-fixes.test.ts > escapes lt and falls back when data is non-serializable`, `packages/core/test/document-seed.test.ts`

---

## SECRET-SPLIT — empty client secret, SSR-only mint

**What:** `virtual:ogygia/secret` is `''` on the client; sign/verify stubs no-op. SSR uses `OGYGIA_SECRET` or a per-build baked fallback. Sign/verify **HKDF-derive** a MAC key (`ogygia-mac-v1`); when `OGYGIA_SECRET` is set, region ids use a separate HKDF salt (`ogygia-id-salt-v1`). Region capabilities are minted as v3 (`&v=3`): `capability()` from `@ogygia/machine` with no nonce, its length-prefixed message naming the capability, its version and its audience (the islands endpoint), so links stay byte-identical within an expiry window (`packages/core/test/region-capability.test.ts`). Only v3 is verified: a capability without `v` (the older `v1|`/`v2|` MACs, ogygia 0.12.x and earlier) is an earlier build's page's, whose runtime cannot run this build's answer, so it is refused as `shape` before any HMAC, renewal and batch included, and its page keeps its fallback (#1769, `packages/core/test/older-build-capability.test.ts`). Production builds reject an `OGYGIA_SECRET` shorter than 16 UTF-8 bytes.

**Why:** Browsers must never mint capabilities. Multi-instance deploys without a shared env need the baked fallback so all replicas agree. Domain-separated keys + length-prefixed fields close classic MAC footguns without requiring the env var on every local demo.

A client build fails (`secret_in_client_chunk`) when a chunk or asset holds a signing secret, or a chunk holds a module that signs. A capability signs its render id (`r`) and its "wakes" mark (`w=1`: the endpoint renders the answer inside an island, as its hydrate does) among its fields.

**Do not:** Embed the real secret in a client chunk. Fail production builds only when you are ready to require env everywhere (local demos still need the fallback). Change the MAC version string without a deliberate invalidate of in-flight capability URLs.

**Enforced by:** `packages/machine/test/capability.test.ts > fields cannot trade text across a boundary`, `packages/core/test/signing-key.test.ts > falls back to the build key without a runtime OGYGIA_SECRET`

---

## PROBE-THEN-RENDER — rate limit ordering

**What:** Pre-HMAC probe limiter → verify MAC → render limiter → render (with process concurrency gate). The order is a machine (`packages/core/src/server/region-request.ts`: received → prechecked → probed → verified → charged → rendering → sent, or refused) that a GET, a renewal and each hole of a batch walk, so rendering or charging the render budget before verify is an illegal move. Each hole of a batch POST is probed, verified and charged on its own, and one call asked twice in a batch renders once.

**Why:** Forged floods must not burn render CPU or reveal id existence (uniform 403). A batch must not buy more renders than the same holes asked one by one.

**Do not:** Charge the render budget before verify. Charge a batch once for all its holes. Trust `X-Forwarded-For` when `getClientAddress()` fails — fail closed (429).

**Enforced by:** `apps/palaestra/e2e/region-rate.spec.ts > a forged flood is all 403, never 429, and a valid request still serves after it`, `packages/compiler/test/audit-fixes.test.ts > documents render-rate contract: junk must not call render limited()`, `packages/core/test/region-request-order.test.ts`

---

## RENDER-TIMEOUT — race without true cancel

**What:** `Promise.race` with 10s timeout; concurrent renders capped (`REGION_RENDER_CONCURRENCY`).

**Why:** Svelte `render()` has no AbortSignal. Timeout stops _waiting_; work may continue until the isolate finishes. Concurrency + rate limits bound damage.

**Do not:** Assume timeout frees CPU instantly. Isolating renders in workers is the real cancel story (out of default scope).

**Enforced by:** `packages/core/test/concurrency.test.ts > a body past its deadline is abandoned: its caller gets the timeout, its slot goes on`, `packages/core/test/sim/render-gate.test.ts > keeps its promise in every order (limit, deadlines, leaving, turn order)`, `packages/core/test/policies.test.ts > render and stream: one try, 10 s`

---

## HOLE-CACHE — every region response says how it may be cached; one request per hole

**What:** A hole is dynamic by default: its answer is `cache-control: no-store`. A hole that opts in (a signed `ttl`, e.g. the `maxAge` preset) is `private, max-age=<ttl>` (never on a renewed answer). Every other region response (a refusal, an error, a keep-fallback 204) is `no-store`. No region response is ever `public` or carries `s-maxage`, and every one carries `Referrer-Policy: no-referrer`. A `defer: 'load'` hole's request starts in the head during the parse (`early-holes.ts`: one data block, one constant inline script), and the runtime takes that request over as the hole's flight, so each hole is asked for once with no cache between them.

**Why:** A region answer can hold one visitor's render and its URL is a capability: no shared cache may keep either. A response with no `cache-control` is heuristically cacheable (a 204 too). A `<link rel="preload" as="fetch">` used to make the early start and needed a cacheable answer for the runtime to reuse; WebKit never hands a preload to a later `fetch()`, so every hole was asked for, and rendered, twice there (#404).

**Do not:** Send a region response without an explicit `cache-control`. Make a hole cacheable by default. Let a shared CDN store a region response. Bring back a preload for the early start.

**Enforced by:** `apps/palaestra/e2e/server-islands.spec.ts > the opt-in cache path (maxAge: '1h' preset) carries a signed ttl + private max-age`, `packages/core/test/browser/early-holes.test.ts`

---

## SPA-HEAD — merge allowlist / deny dangerous tags

**What:** SPA head merge skips `<base>` and dangerous `meta[http-equiv]` (refresh / CSP / set-cookie; `packages/core/src/runtime/head-deny.ts`), and the head never gains one after the first document (the rule `rule_head_adopted`, in dev and at the end of every e2e test). Only `script[type=module][data-ogygia-runtime]` is retained across navigations. The router starts only when `meta[name=ogygia-router]` is present **and** the document is not Kit-booted (`csr=true`). Navigating toward a Kit-bootstrap HTML response does a full load.

**Why:** Adopting `<base>` rewrites relative capability fetches. Keeping every module script forever leaks memory across SPA pages. Dual routers on a Kit page would fight click interception — gradual migration needs root `<OgygiaRouter/>` to be a no-op on `csr=true` routes.

**Do not:** Assume SPA body swap can boot Kit inline scripts (it cannot — that is why Kit targets full-load).

**Do not:** Re-enable “keep all module scripts” without a runtime marker. Prefer HTTP CSP headers over CSP meta (meta is mergeable).

**Owned head tags:** a head tag a region writes (its region sheets, the `ogygia-kit-island` stamp) names its owner, `data-og-owner` = the outermost island’s fingerprint. The server skips a region the browser already has (`x-ogygia-known`) and every tag its inner regions write with it, so the merge keeps an unlisted owned tag while a region with that fingerprint stays (`release_head_nodes`, #806, `e2e/head-owner-kept.spec.ts`). The attribute is a space-separated list: a sheet several outer islands share is written once, naming the first, and the page's tail lists the rest (`<script type="application/json" data-og-owners>`, sheet identity → fingerprints); the router adds those, and the owners a later page's copy names, to the tag, and keeps it while any is on the page (#854, `test/browser/shared-sheet-owners.test.ts`).

**Enforced by:** `rule_head_adopted`, `packages/core/test/browser/spa-head-deny.test.ts > a fetched page’s <base> and refresh / CSP / cookie metas are never adopted, in any case`

---

## ISLAND-GRAPH-SHIMS — `$app/*` only for island importers

**What:** Client `$app/state|stores|navigation` resolve to shims when the importer is in `island_graph`.

**Why:** Kit’s client page is uninitialized under `csr=false`; islands still need a working `$app/*`.

**Do not:** Remove shims to “fix” shared-module confusion — that pulls the Kit router into island chunks. Isolate with `?ogygia-island` only as a careful follow-up.

**Enforced by:** `packages/compiler/test/island-closure-alias.test.ts > the marked script helper leaves the client transform importing the SHIM`, `packages/core/test/kit-shim-surface.test.ts`

---

## LAKE-PLACEHOLDER — no lake JS on the client

**What:** Client build rewrites lake imports to the render-nothing `ClientBindingStub.svelte` (`compiler/region/emit.ts` `rewrite_lake_import_to_placeholder`); SSR keeps the real component. Runtime lifts/restores SSR DOM around hydrate.

**Why:** `hydrate: 'none'` means zero lake client JS.

**Do not:** Import lakes through dynamic components that add comment envelopes the restore path cannot round-trip (LAKE-ENVELOPE).

**Enforced by:** `packages/compiler/test/audit-fixes.test.ts > rewrites default lake imports`, `apps/palaestra/e2e/lakes.spec.ts > /lakes: frozen region, island-in-lake, inert lake button, remount cache + swr`

---

## NESTED-DEGRADE — one interactive tree

**What:** Island-in-island hydrates with the parent; server-island-in-island renders inline (`defer` ignored).

**Why:** Nested custom elements + separate hydrate schedules double-hydrate and break context.

**Enforced by:** `apps/palaestra/e2e/nested.spec.ts > SSR: exactly ONE waking ogygia-region (outer); inner degrades inline`, `apps/palaestra/e2e/nested.spec.ts > browser: single hydration`

---

## SOFT-INVALIDATE — `invalidateAll` does not body-swap

**What:** `invalidateAll()` / `invalidate()` bust the SPA HTML cache, re-fetch the current URL,
merge `<head>`, and refresh `application/ogygia-page` + `application/ogygia-remote` seeds **in
place**. No `body.replaceWith`, no view transition, no island remount, no live query-map clear,
no auto-refresh of live queries. Does **not** fire `beforeNavigate` / `afterNavigate` (Kit soft
invalidate is not a navigation). Soft fetch abort/generation is separate from hard `navigate()`
so an invalidate cannot cancel an in-flight click nav.

**Why:** Kit remote `form()` always calls `invalidateAll` on success. A full SPA navigate+VT was
tearing down live islands and could re-paint stale SSR HTML (in-memory remotes / multi-isolate).
Kit’s own invalidate re-runs loads without destroying the tree — soft invalidate matches that.

**Do not:** Route form success through `navigate(location.href, { replace: true })`. Fire nav
hooks as `type: 'goto'` from soft invalidate. Auto-refresh every live query on soft invalidate.
Islands that need fresh remote data should `.refresh()`, or Kit single-flight
`submit().updates(query)` **paired with** server `requested(query, n).refreshAll()` (updates alone
only sends keys + skips invalidate — without `requested`, the POST has no `q` and live
`.current` stays stale). Hard remount + VT only on real route change.

**Enforced by:** `packages/core/test/browser/soft-refresh-page-on-screen.test.ts > invalidateAll while a navigation waits refreshes the page on screen, not the next one`, `packages/core/test/browser/sim-router.test.ts`

---

## QUERY-LIVE — Kit owns SSE

**What:** `query.live` is Kit’s remote SSE. Ogygia reuses Kit’s client remote primitives. On SPA
body swap: clear SSR seeds _before_ `replaceWith` (old islands still mounted); _after_ it (old
disconnected, kept ones still in the page, new hydrates still awaiting), release the
`query_map` / `live_query_map` entries whose holders all left. A holder is a region whose island
looked the entry up or made it while it hydrated; an entry no island held is Kit’s to keep.
The remote cache singleton lives on `globalThis` so Vite duplicate-module loads still share maps.

**Why:** Abort on `request.signal` is Kit’s job. Infinite `while (true)` generators are normal;
disconnect cancels. Kit’s `LiveQuery.#start` is `once()` — reusing a spent instance after nav
never opens SSE again (stuck on pending / “connecting…”). Clearing too early throws
“No cached query found” mid-unmount. A per-module `new RemoteCache()` breaks SPA clear when
the runtime chunk and island graph resolve the shim to different module ids.

**Do not:** Treat public demo `query.live` as an ogygia ServerIsland vulnerability. Do not clear
instance maps in `prepare_spa_document` (pre-swap). Do not clear them whole after the swap either:
a kept island’s live query then freezes and its next read throws (#817,
`e2e/live-query-kept.spec.ts`, `test/remote-cache-holders.test.ts`).

**Enforced by:** `packages/compiler/test/audit-fixes.test.ts > clear_remote_seeds leaves live/query instance maps intact`, `packages/compiler/test/audit-fixes.test.ts > remote_cache is shared via globalThis across re-imports`

---

## PAGE-CSR — a page's csr is Kit's rule; a layout's world derives from its pages

**What:** `compiler/kit.ts` computes every `+page.svelte` leaf's Kit-effective csr exactly the way Kit does — the option-file chain root → page dir (`+layout.*` then the page's own `+page.*`), deepest declaration wins — walked ONCE per routesDir and memoized (`page_worlds`). Every other csr decision DERIVES from that map:

- a **page host's** compile world is its own entry;
- a **`+layout.svelte` host** has NO world of its own — it folds the pages at/below its dir: all true → strip (Kit hydrates every page it serves), all false → island world, mixed → shared world (islands kept; `documentIsCsrTrue` degrades per document at runtime); no pages below → its own chain;
- the runtime `csr_true_routes` set is the same map's true entries.

**Why:** A layout serves pages; judging it by its own partial chain is wrong the moment a `csr` declaration lives below it. That exact shape (`csr = false` only in a deep catch-all, root layout undeclared) stripped a consumer's root Header/BootEffects to plain while Kit shipped no client for those pages — dead chrome everywhere.

**Do not:**

- Read `export const csr` ad hoc anywhere else — go through `page_worlds()` / the exported kit.ts helpers (one walk, one truth).
- Strip a layout when ANY page below it is csr=false.
- Read a route file around `ctx.routes` (its `text`, `listing` and `at` inputs): an answer that reads the disk itself is not told of the dev watcher's file events (`Routes.touch`), so it goes stale.

**Enforced by:** `packages/compiler/test/route-csr.test.ts` (declaration forms × chain shapes × layout folds × file events, plus the transform strip/keep seam), `packages/compiler/test/queries.test.ts` (dev answers after random edits equal a cold reader's), `packages/compiler/test/fs-seam.test.ts` (no direct disk read left), `apps/palaestra/e2e/deep-csr.spec.ts` (real build of internal/repro-deep-csr, browser truth in both worlds).

---

## RESPONSE-MARK — a document's side channels are read only from its own response

**What:** Every response has one random mark, made on the first ask for its request (`server/response-mark.ts`). It is written as `data-og-mark` on the head runtime script (`head-presence.ts` `runtime_first`, so every head path stamps it, the handle's and `document()`'s) and on every side channel the response writes into the document: the page seed, the remote seed, the page context root, the holes record and the devtools events. The client reads a channel only when it bears the mark of its document's head runtime script (`runtime/response-mark.ts` `server_channel` / `server_channels`, the door for every document-level channel the runtime reads; the second door is Kit's env reader, `runtime/kit-env.ts` `env_channel`, which spells the same read again because it may import nothing of the runtime's, KIT-PUBLIC-ENV); no mark there means no channel is read. A navigation keeps the live runtime script, so it takes the next document's mark and code origins (`adopt_response` in `router-nav.ts` `merge_head`; the origins are read again as at boot, #1045). Only well-formed server events pass `ingest` (#879).

**Why:** Page markup (a CMS block, an HTML field rendered raw, a sanitizer that keeps scripts of a type that does not run) can carry a script of any of these types, before or after the server's. It cannot know a mark made for this response, so islands get the server's page data, remote values, context and hole endpoints, and the dock shows only what the server recorded (#881, #893).

**Do not:**

- Read a document-level channel by its type or marker alone, or read the mark from anywhere but the head runtime script.
- Put the mark after the tag's other attributes: a repeated attribute keeps its first value, so leading it beats a mark the markup wrote on the tag.
- Write a side channel of a response with another request's mark, or with none.

**Enforced by:** `packages/core/test/browser/side-channel-seeds.test.ts` (every channel, before and after, a fetched document, an unmarked one), `packages/core/test/browser/side-channel-seeds.test.ts > Kit's env reader finds the channel the runtime's door finds, in every document shape`, `packages/core/test/browser/devtools-feed-own-render.test.ts` (devtools), `packages/core/test/head-presence.test.ts` (the mark on every placement), `packages/core/test/response-mark.test.ts` (one mark per response, on the holes record).

---

## CONTEXT-CURSOR — one slot for the region being hydrated

**What:** The region the runtime is hydrating (the anchor a cross-island `context.get()` walks up from) and the foreign island it is delegating to another build (`set_foreign_hydrate`) each live on one `globalThis` slot under a `Symbol.for` key (`packages/core/src/current-region.ts`). The runtime writes them; the context feature and the `$app/*` shims read them.

**Why:** The context feature is bundled apart from the runtime, and a federated island's build is another bundle again: each has its own copy of the module. A module-level variable would be one slot per copy, so the reader would see `null` while the runtime is hydrating, and a nested `get()` would find no context.

**Do not:** Keep the cursor in a module variable or behind an import the other bundle does not share. Move it into a module with heavy imports (it lives alone so the boot stays small).

**Enforced by:** `packages/core/test/current-region-slot.test.ts > two copies of the module share the region being hydrated, and the foreign island`

---

## COMMENTS-ARE-TESTS — a comment's why lives in a test, not in prose

**What:** Package source holds no free comments. What a comment knows (a rule, a reason, a past bug) is moved into something that fails when it stops being true: a test named after the behavior, a DST seed, a rule, a lint rule or a type. Only then is the comment deleted. What stays: JSDoc on exports (it feeds the API reference and hovers), tool directives with a reason, and `// @why <outside fact> (test: file › name)`, one line, for a fact no test can hold, naming the test that pins it.

**Why:** A comment goes stale without anyone noticing; a test fails out loud. Deleting a comment without moving its why throws the knowledge away, so deletion is never the aim, only the last step.

**Do not:** Delete a comment whose why has no test yet (flip the code; if nothing turns red, write the test first). Reword an old comment instead of moving it. Add a free comment to new code. Write a `@why` that names no test, or a test that does not exist.

**Enforced by:** `internal/lint/structured-comments.test.ts > free comments and block comments are reported; tool directives pass`, `internal/lint/structured-comments.test.ts > a @why passes only above its statement and when its test exists`. The rule is an error in `.oxlintrc.json` for each package that has reached zero (the compiler first); elsewhere `internal/checks/new-comments.ts` refuses new ones while the sweep goes on.

---

## KIT-CLIENT-BUILD — a csr=false-only app still gets Kit's client build

**What:** When every route node is `csr = false`, SvelteKit skips its client build, and the islands then have no `_app/immutable` output, no client manifest and no runtime to load. The compiler predicts Kit's skip with Kit's own rule (`clientBuildWillSkip` in packages/compiler/src/kit.ts: a node is `csr = false` by its option chain) and, when Kit would skip, injects a hidden `csr = true` route (`KEEP_CLIENT_DIR`) for the build, removed after. A worker build (Kit's analyse and prerender) neither injects it nor sweeps it.

**Why:** Kit's skip is Kit's private build logic, not a promise. If the rule changes (another condition, another place), the prediction goes wrong without a word: either the keep-alive route is missing and a csr=false-only app ships islands with no client, or it is injected where it is not needed.

**Do not:** Predict the skip by any other rule than Kit's, or keep the injected route after the build.

**Enforced by:** `packages/compiler/test/canary/kit-build.test.ts > skips its client build, as the compiler predicts`, `packages/compiler/test/canary/kit-build.test.ts > keeps its client build while one route node is csr=true, as the compiler predicts`, `packages/compiler/test/csr-skip.test.ts > every node explicitly csr=false (layout AND pages) → skip (the adapters-fixture shape)`, `packages/compiler/test/csr-skip.test.ts > the injected keepalive dir is invisible to the prediction`, `packages/compiler/test/keep-client-worker.test.ts`, `apps/palaestra/e2e/adapters.spec.ts` (a built csr=false-only app loads its runtime on every adapter)

---

## KIT-CSR-FALSE-ASSETS — a csr=false page links the CSS of what it rendered

**What:** SvelteKit links every route node's client `stylesheets` from the node's CLIENT module graph, on csr=false pages too (the `modulepreload`s it links on csr=true pages only). A region host that imports many marked components (a block registry) would put every one of their sheets in the page's head, rendered or not. The compiler stubs a region host's client imports (packages/compiler/src/region/emit.ts, the render-nothing registry stubs), so the client graph holds only what the page placed, and the rendered islands' CSS reaches the page through the region-CSS channel.

**Why:** Kit's linking is Kit's private render logic. If Kit starts linking by what the server rendered, the stubs become unneeded; if it starts linking more (another graph), unrendered CSS lands on the page again and first paint slows.

**Do not:** Let a region host's client import reach Kit's client graph whole.

**Enforced by:** `packages/compiler/test/canary/kit-build.test.ts > links every route node's client stylesheets on a csr=false page, rendered or not`, `apps/palaestra/e2e/head-budget.spec.ts > SSR: linked stylesheets carry the rendered islands only, within budget`, `apps/palaestra/e2e/head-budget.spec.ts > SSR: a registry behind a plain helper module gets the same treatment`

---

## KIT-PUBLIC-ENV — a page Kit never starts gets Kit's public env from its server

**What:** Kit 3's browser `$app/env/public` reads its dynamic public variables (`public: true, static: false`) from Kit's boot payload: `globalThis.__sveltekit_dev.env` in dev, `payload.env` in a build. Only Kit's client boot fills it, so on a `csr = false` page an island that imports the module threw on import (#2177). The compiler patches the module (packages/compiler/src/kit-patches.ts, `KIT_PATCHES`, the one table of Kit module patches) to read Kit's payload first and otherwise `kit_env()` (core runtime/kit-env.ts). That reads the `application/ogygia-env` side channel, which the server writes beside the page seed (core server/env-seed.ts): Kit's `rendered_env` (what Kit sends as `env` on a csr=true page, public variables only), devalue-serialized beside the build that wrote it (`{ build, env }`), with the response's mark (RESPONSE-MARK), on its own ask (one ask record with the page seed's keys, but not under the page feature's bit: `$app/env/public` reads no page), and only on a page where a region asked (`region_reads_env`: the island's client chunk closure holds Kit's env module; fail-open in dev and for an unknown entry). The client module holds no value, so dev reads an edited variable on the next load. Kit's module runs as soon as a region's module runs, which can be before any lazy runtime chunk took the boot's link (the hydrate core loads beside the region's module; a hover warm loads it ahead of the replay chunk), so the reader finds the channel on its own, by the mark of the head runtime script, and imports nothing of the runtime's: its warning's chunk loads only when it has something to say. The build's identity (`kit_env_build`, compiler kit-patches.ts: a hash of the app's package.json, base and app dir and of every file of its source, `src` and Kit's routes dir, but dot files, made once per build and kept on the compiler's build state, which the client leg's context carries on, so a build's two legs bear one though the source changes between them; no absolute path and no time, so a build made again is byte-identical; made only where Kit's generated env config for the mode, `<outDir>/generated/<mode>/env/config.js`, sets a dynamic public variable, or cannot be read: an app with none has an empty env, so no channel is written or read, and its identity is `''` with no file of its source read, and a dev app that gains its first one is asked again and gets its own) is a constant in the browser's reader (`ogygia:boot/kit-env`) and in a build's server module; the reader takes the env only from a channel that bears its own. The server module writes the identity it has as it writes each channel (`kit_env_build()`): in dev that is the dev server's own, read through the dev bridge (compiler dev-bridge.ts: one `Symbol.for` global per app root, `dev_bridge_key`, holding this reader and the dev `fn_manifest()`'s, which read the compiler the plugin session holds when they are asked; the global is `DevServers`, the one registry of the root's open dev servers: each `configureServer` adds its server, with its environments, the plugin serving it and its bridge, under that server's own scope, so a closing server leaves it by itself; the bridge answers with the newest one still open, and with nothing once none is; a module finds the global by the root only, so while two dev servers of one root are open both read the newest one's compiler, #2229. The plugin reads the same registry: a hook runs on the open server holding its environment, else the newest one it serves still open, and what the compiler hands out once (moved modules, closure marks, route answers, a host's islands) is dropped from every open server it serves, while a replay and a full reload stay on the server that heard the event), because Vite loads the server module once while the reader is made later, so an app started with no dynamic public variable writes the identity its reader is bound to once it gains one. Dev's module destructures Kit's global even when every variable is static, so in dev it is always patched (to an empty env when it reads no dynamic variable); the empty module Kit writes for an app with no `src/env.js` is left as it is, and says nothing. A page whose env holds no variable never asks the identity. A router page writes the channel in its head; the router's head merge keys a marked inline script by its mark too, so one response's channel never stands for the next one's. Kit's module reads the env once, as it first runs, from the open document only, and the runtime can run it before the page that carries the env is open: a prefetch (a hover preload, which Kit's default `app.html` turns on with `data-sveltekit-preload-data="hover"`, or the router's) warms the next page's islands while this page is open, and an island inside a region answer (a server hole, a region a remote call renders) runs on a page that asked for none. Those islands read an empty env and say `kit_env_missing`; they never throw, and no answer carries an env channel (#2219). A federated Kit 3 peer's island runs in the host's document, where the channel is the host's, written by another build: it reads an empty env and says `kit_env_missing`, never the host's values, unless the peer is built from the very same source, package.json, base and app dir as the host (carrying the peer's own env is #2221). The built patch also runs on Kit's own client build: Kit's pages and the islands import one module there, so a csr=true page of an app with dynamic public variables loads ogygia's reader (one small chunk; devalue is Kit's own) and never calls it. A prerendered `csr = false` page carries the build's values of its dynamic variables, where Kit's prerendered `csr = true` page loads `_app/env.js` at runtime (#2212). Kit 2 is not covered (#2211).

**Why:** Both ends are Kit's private code: the generated module's text, and `rendered_env` in `<sveltekit:generated>/env/config.js`. If Kit changes the read, the patch finds no anchor and says `kit_env_unpatched`, and so does a module whose anchor is there but whose read of `env` is not one the patch knows as dynamic (a string or a comment that names `env` reads nothing). The patch finds strings and comments with one regex scan, not a parse, so two shapes Kit never writes there are read wrongly: a template literal holding `${env.X}` reads as a string, so its dynamic read is missed, and a regex literal holding `/*` or `//` (such as `/\/*/`) reads as a comment. Kit writes its values with devalue's `uneval`, which writes quoted strings and `new RegExp(…)`, never either shape; if Kit's module ever holds one that hides its dynamic read, the canary's check that the patch sees the app's dynamic variable in the module Kit generated (`generates every module the patch table patches, in the text each row reads`, dev and build) fails. If it moves `rendered_env`, the server's import breaks the build; if it stops setting a dynamic public variable as `rendered_env.<name> =` in its config, the canary says so before the identity goes empty.

**Do not:** Inline env values into the client module (dev went stale until a restart; a build never had them). Send anything but `rendered_env` (private variables must never reach the page). Write the channel on a page no region asked for it on. Read the channel through the boot's link, or take an env another build wrote.

**Enforced by:** `packages/core/test/browser/kit-env-unlinked.test.ts > a region's module that runs before any lazy chunk took the boot's link reads the env its page carries`, `packages/core/test/browser/kit-env-answers.test.ts > a channel another build wrote (a federated peer's region on the host's page) reads as an empty env, and says kit_env_missing`, `packages/compiler/test/kit-env-build.test.ts > the build's identity on Kit's env channel (KIT-PUBLIC-ENV)`, `packages/compiler/test/kit-env-build.test.ts > the build's identity is made only for an app whose payload carries an env (KIT-PUBLIC-ENV)`, `packages/compiler/test/canary/kit-build.test.ts > sets its dynamic public variable in its env config, where the compiler looks before it hashes the source`, `packages/core/test/browser/kit-env-warning-lost.test.ts > a page with no env channel whose warning chunk does not load still reads an empty env, and leaves nothing unhandled`, `packages/compiler/test/canary/kit-build.test.ts > generates every module the patch table patches, in the text each row reads`, `packages/compiler/test/canary/kit-build.test.ts > sends its server module's rendered_env as a csr=true page's payload env`, `packages/compiler/test/canary/kit-build.test.ts > ogygia's server module renders Kit's public env in dev, and its channel holds no private or static variable`, `packages/compiler/test/vite-hooks.test.ts > Kit 3's $app/env/public (KIT-PUBLIC-ENV)`, `packages/core/test/server-seed-word.test.ts > Kit's public env (KIT-PUBLIC-ENV)`, `packages/core/test/browser/side-channel-seeds.test.ts > Kit's public env reads the server's channel, not one the page markup carries before it`, `packages/core/test/browser/router-nav-claims.test.ts > a page's marked side channel in the head is that page's, after a page that carried the same text`, `packages/core/test/browser/kit-env-answers.test.ts > a prefetch from a page with no env channel: the island it warms reads an empty env and says kit_env_missing`, `packages/core/test/browser/kit-env-answers.test.ts > an island inside a region answer, on a page with no env channel, reads an empty env and says kit_env_missing`, `packages/core/test/server-seed-word.test.ts > Kit's public env (KIT-PUBLIC-ENV) > a region rendered for a page (a server hole, a remote call) carries no env channel in its answer, even when an island in it imports it (#2219)`, `packages/compiler/test/runtime-boot-svelte-free.test.ts > island-side modules reach the runtime only through its handles > runtime/kit-env.ts imports no boot module`, `packages/compiler/test/page-mark.test.ts > page mark > $app/env/public reads no page: Kit's public env ships on its own ask`, `packages/compiler/test/kit-env-build.test.ts > the build's identity on Kit's env channel (KIT-PUBLIC-ENV) > dev: the server module writes the dev server's identity as each channel is written, so an app that gains its first dynamic public variable writes the one its reader, made later, is bound to`, `packages/core/test/server-seed-word.test.ts > Kit's public env (KIT-PUBLIC-ENV) > the channel bears the server's identity as it is written, not one kept from an earlier page with the same env (a dev app that gains its first dynamic public variable)`, `apps/palaestra/e2e/kit3.spec.ts > SvelteKit 3: build + dev on the packed ogygia (self-building fixture) > dev: an app started with no dynamic public variable reads its first one once it is added, and its static value once it is static again, with no warning`, `packages/compiler/test/vite-hooks.test.ts > the dev bridge: what a dev server's generated server modules read off the compiler serving them`, `packages/compiler/test/vite-hooks.test.ts > the dev bridge: what a dev server's generated server modules read off the compiler serving them > a newer dev server of the root closing first leaves the older one reading its own bridge`, `packages/compiler/test/vite-hooks.test.ts > the dev bridge: what a dev server's generated server modules read off the compiler serving them > one plugin serving a restarted dev server: the old server closing its plugins leaves the new one open`, `packages/compiler/test/vite-hooks.test.ts > the dev server > one edit both open dev servers' watchers hear updates the route answers on both servers, not only the first to hear it`, `packages/compiler/test/vite-hooks.test.ts > the dev server > a style edit heard by one of two open dev servers drops the router's inlined CSS module from both servers' graphs`, `packages/compiler/test/vite-hooks.test.ts > the dev server > a transform that moves what a loaded virtual module read drops that module from the dev server's graph`, `packages/compiler/test/vite-hooks.test.ts > the dev server > closing an older dev server while a newer one is open leaves the newer one serving a hook with no environment`, `packages/compiler/test/vite-hooks.test.ts > the dev server > closing the newest dev server leaves the older one serving a hook with no environment, as the dev bridge then reads the older one`, `packages/compiler/test/vite-hooks.test.ts > the dev server > a module an island pulls into its world, transformed on one of two dev servers, is dropped from every open server's graph`, `packages/compiler/test/vite-hooks.test.ts > the dev server > a file event heard on one of two dev servers is read again, replayed and reloaded on that server, never on the other, which once closed hears nothing`, `packages/compiler/test/kit-env-build.test.ts > the build's identity is made only for an app whose payload carries an env (KIT-PUBLIC-ENV) > a build makes its identity once, kept on the build its next leg's context carries on: both legs bear one, though the source changes between them`, `packages/core/test/server-seed-word.test.ts > Kit's public env (KIT-PUBLIC-ENV) > a page whose env holds no variable never asks the build's identity (a dev server with no dynamic public variable reads no config for it)`, `apps/palaestra/e2e/kit3.spec.ts` (a dynamic variable on a csr=false page, built and in dev, and an edited default in dev; an interaction region that reads it, opened straight and reached by the router from a page with no env)

---

## KIT-CONFIG — the Kit options the compiler reads

**What:** The compiler reads `kit.files.routes`, `kit.outDir`, `kit.appDir` and `kit.inlineStyleThreshold` from the app's config (`svelte.config.js` on Kit 2, the `sveltekit()` plugin options on Kit 3), each with Kit's default when unset, and says `kit_config_unreadable` when the config throws as it loads.

**Why:** These are Kit's public options, but their place (Kit 3 moved them) and their defaults are Kit's. A renamed or moved option read with the old name falls back to the default without a word, and the compiler then scans the wrong routes or writes to the wrong dir.

**Do not:** Read a Kit option without a default that matches Kit's, or from one place only.

**Enforced by:** `packages/compiler/test/canary/kit-build.test.ts > as the compiler reads them`, `packages/compiler/test/canary/kit-build.test.ts > inlines the stylesheets under`, `packages/compiler/test/kit-dirs.test.ts > reads both from svelte.config.js and resolves them against the root`, `packages/compiler/test/kit-dirs.test.ts > off Kit's own plugin: Kit 3's options at the top (vite.config only), Kit 2's under`, `packages/compiler/test/kit-dirs.test.ts > Kit's inlineStyleThreshold is read for the region CSS too`

---

## IMAGE-SIGNED-RECIPE — the image endpoint makes only what the app signed, from what it ships

**What:** `@ogygia/image`'s endpoint (`/__ogygia__/i/<sig>/<recipe>`) makes a file only for a recipe
the app signed (`app.sign('image|<recipe path>')`, the plugin's own domain under the region key), of
an original in the build's list (`Originals`: the assets the SSR imports gave), named by a hash of
that original's bytes. The order is fixed: method (GET/HEAD, else 405), then the signature (else a
uniform `deny('sig')` 403), then the strict recipe parse (a tail with `.`/`..` segments, a
backslash or NUL is no recipe), then the list (else 404), then the query (a 308 to the bare URL).
Every refusal is `no-store`; a made file is `immutable`, but one made from a remote URL's bytes (a
`remoteImage()` file, or a card that shows a remote image) is kept for its `remote.maxAge` window,
never `immutable` (`packages/image/test/card-remote-live.test.ts`). The original is re-read and checked
against the id the recipe names: an edited source never answers the old URL with new pixels.

**Why:** A signed URL never expires: it is minted once per recipe and kept by every CDN forever, so
the signature is the whole door. Only the server holds the key; the signer's domain separation
means no region capability or other plugin's signature verifies here, and an image signature
verifies nowhere else.

**No rate limit (on purpose):** unlike the region endpoint (PROBE-THEN-RENDER), a forged flood is a
cheap HMAC check and a 403 with no encode; a replay of harvested URLs is bounded by the store
(each recipe that makes a file is made once), by the memory of failed remote URLs (a remote URL
that failed is answered its remembered status for 30 s, with no fetch, and said once per failing
streak), by the fetch line (16) and the encode queue (`parallel`), each with its 503 past a full
line. Do not "align" it with the region limiter: there is no costly work before the signature to
protect.

**Do not:**

- Sign a recipe whose source is not an asset of this build, or derive a recipe from the request.
- Answer a refused request with anything a cache may keep.
- Read an original at a path built from the request: read it at the URL its import gave
  (`Originals.url`), which is what Kit's `read()` takes.

**Enforced by:** `packages/image/test/server.test.ts > a URL whose recipe was changed after signing is refused, naming why and the key`, `packages/image/test/server.test.ts > a URL with no signature, or a forged one, is refused`, `packages/image/test/server.test.ts > a signed recipe naming an original the app does not ship is not found`, `packages/image/test/server.test.ts > a signed URL asked with any method but GET or HEAD is answered 405`, `packages/image/test/recipe.test.ts > a tail that climbs out of its folder is no recipe`, `packages/image/test/settle-live.test.ts > a signed URL asked with a query string is sent to the bare URL, and nothing is made`, `packages/image/test/server-assets-path.test.ts > with paths.assets set to a CDN, a signed file is made from the original Kit serves there`, `packages/core/test/plugin-signing.test.ts > a v3 region signature does not verify as a plugin signature of any field`, `packages/image/test/remote-request.test.ts > a remote URL that failed is not fetched again for a while: its files answer the remembered status, said once, and it is asked again once the memory ends`, `packages/image/test/card-endpoint.test.ts > a live card whose image the remote host refuses answers the remote's status, not a 500 for the card`

---

## IMAGE-REMOTE-SSRF — every fetch of an image goes through one guard

**What:** `@ogygia/image` fetches an image from another host in four places: a build source
(`import.meta.og.image('https://…')`), a prerendered `remoteImage()`, the endpoint's live
`remoteImage()` file, and an image a share card's markup names. Every one goes through
`fetch_image` (`src/remote-fetch.ts`) under `image({ remote })`: the host must be in `hosts` (each
redirect hop checked again, at most 3), credentials and other schemes are refused, the body is
capped by `maxBytes` (by length and while streaming), the whole chain by `timeout`, and the bytes
must say and start like a raster image. A host taken only by a `*.` entry must resolve to public
addresses only, checked in the connection's own lookup (so DNS rebinding is covered); a host an
entry names itself is trusted wherever it points. A `*.` entry over a public suffix anyone can host
under (`*.co.uk`, `*.github.io`) is refused. With an encoder's own links (`cloudflare()`,
`vercel()`), an unlisted host gets no link at all (the CDN would fetch it), only the endpoint's
URL, which refuses it. A card's engine (satori) never fetches: every address a card's markup names
(any element's `src`, an SVG element's `href` or `xlink:href`, any `url()`, its entities decoded
first; a link's `href` outside an SVG is left out) is read by the card's realm through this guard,
fitted to the card by sharp (refused from its header past the one-frame limit, made smaller past
what the card draws) and handed over as bytes, or the card is refused (`image_card_source`); a
`data:` URL must hold raster bytes (an SVG can name addresses itself). The tree satori is handed is
checked whole right before the draw: an address left in it that is not bytes, a raster `data:` URL
or a `#` reference (an unclosed `url(` included) refuses the card. A remote image is never made
larger than its real size, and no recipe asks for more pixels than one frame may have, whatever
size its URL's owner claims.

**Why:** `remoteImage()` and cards take URLs from CMS or user data. Without one guard, any of those
paths is a server-side request forgery (cloud metadata, intranet hosts) or a memory bomb.

**Do not:**

- Fetch an image anywhere but through `fetch_image` with the app's `RemoteHosts`, its limits and
  the runtime's transport (Node's checks the `*.` rule; a Worker's `fetch` reaches no private
  address).
- Hand a URL to anything that fetches it itself (satori, a CDN link) without checking its host.
- Trust a size a URL's owner states.

**Enforced by:** `packages/image/test/remote-request.test.ts > a host listed only by *. that resolves to a private address is never connected to; one the list names itself is`, `packages/image/test/remote-request.test.ts > past maxBytes is 413, past the timeout 504, an error status or not an image 502, a redirect off the list 404: each kept nowhere, each said`, `packages/image/test/remote-request.test.ts > a small remote image the CMS says is huge is never made larger than it is`, `packages/image/test/remote-image.test.ts > loopback, private, link-local (cloud metadata), shared, reserved and multicast addresses are private; a public one is not`, `packages/image/test/remote.test.ts > redirects are followed, each hop checked, at most 3`, `packages/image/test/remote.test.ts > a *. entry over a public suffix anyone can host under is refused; one over a name below it, or that name itself, is not`, `packages/image/test/remote-image-links.test.ts`, `packages/image/test/card.test.ts > an image a card's markup names at an address the app does not read it from is refused, coded, and never fetched`, `packages/image/test/card.test.ts > an SVG <image>'s href, a mask's url() and a data: SVG in a card are the realm's to read or refuse: satori never calls fetch`, `packages/image/test/card.test.ts > a card's image URLs reach its realm as the markup means them: &amp; in a query, &quot; around a url()`, `packages/image/test/card-images.test.ts > a small file of huge dimensions (a 20000 x 20000 PNG header) is refused, coded, before anything decodes it`, `packages/image/test/card-images.test.ts > an image larger than the card reaches satori fitted to it: covering the card, at most four times its pixels`, `packages/image/test/card-images.test.ts > a style's url( with no closing paren is refused, coded, and satori never calls fetch`

---

## Related docs

- Product vocabulary: [`DESIGN.md`](./DESIGN.md)
- Public API: docs site + [`packages/ogygia/README.md`](../../packages/ogygia/README.md)
- Spec / goals: [`SPEC.md`](./SPEC.md)
