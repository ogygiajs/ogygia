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

**Enforced by:** `packages/compiler/test/region-mac.test.ts > rejects expiry or props tampering`, `packages/core/test/capability-expiry.test.ts > is always valid for more than ttl/2 and at most ttl`

---

## PAGE-SEED — `application/ogygia-page` on `csr=false`

**What:** `ogygiaHandle` injects a document-level devalue snapshot of `page` (including `data` / `form` / `error` when serializable).

**Why:** Islands use `$app/state` / `$app/stores` shims. Without a seed, `page.data` is empty under `csr=false` (Kit only serializes it when `csr=true`).

**Invariant:** Same **client visibility** contract as Kit `csr=true`. Stock `csr=false` without ogygia keeps load data server-only — enabling ogygia changes that. Document it; do not treat it as an accidental leak.

**Do not:** Strip `data` by default without an opt-in API for islands that read `page.data` (would break real apps).

**Enforced by:** `packages/compiler/test/audit-fixes.test.ts > escapes lt and falls back when data is non-serializable`, `packages/core/test/document-seed.test.ts`

---

## SECRET-SPLIT — empty client secret, SSR-only mint

**What:** `virtual:ogygia/secret` is `''` on the client; sign/verify stubs no-op. SSR uses `OGYGIA_SECRET` or a per-build baked fallback. Sign/verify **HKDF-derive** a MAC key (`ogygia-mac-v1`); when `OGYGIA_SECRET` is set, region ids use a separate HKDF salt (`ogygia-id-salt-v1`). Region capabilities are minted as v3 (`&v=3`): `capability()` from `@ogygia/machine` with no nonce, its length-prefixed message naming the capability, its version and its audience (the islands endpoint), so links stay byte-identical within an expiry window; the older `v1|`/`v2|` length-prefixed MACs are still verified (pages cached before the upgrade) and a renewal re-signs them as v3 (`packages/core/test/region-capability.test.ts`). Production builds reject an `OGYGIA_SECRET` shorter than 16 UTF-8 bytes.

**Why:** Browsers must never mint capabilities. Multi-instance deploys without a shared env need the baked fallback so all replicas agree. Domain-separated keys + length-prefixed fields close classic MAC footguns without requiring the env var on every local demo.

A client build fails (`secret_in_client_chunk`) when a chunk or asset holds a signing secret, or a chunk holds a module that signs. Messages are `v2|` (the render id signed too) for every current mint of a hole that does not wake, and `v3|` (the "wakes" mark `w=1` signed too, so the endpoint renders the answer inside an island, as its hydrate does) for one that does; `v1|` is still verified so pages cached before an upgrade keep their holes.

**Do not:** Embed the real secret in a client chunk. Fail production builds only when you are ready to require env everywhere (local demos still need the fallback). Change the MAC version string without a deliberate invalidate of in-flight capability URLs.

**Enforced by:** `packages/compiler/test/region-mac.test.ts > length-prefixes so embedded nulls cannot shift field boundaries`, `packages/core/test/signing-key.test.ts > falls back to the build key without a runtime OGYGIA_SECRET`

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

**What:** Every response has one random mark, made on the first ask for its request (`server/response-mark.ts`). It is written as `data-og-mark` on the head runtime script (`head-presence.ts` `runtime_first`, so every head path stamps it, the handle's and `document()`'s) and on every side channel the response writes into the document: the page seed, the remote seed, the page context root, the holes record and the devtools events. The client reads a channel only when it bears the mark of its document's head runtime script (`runtime/response-mark.ts` `server_channel` / `server_channels`, the one door for every document-level channel); no mark there means no channel is read. A navigation keeps the live runtime script, so it takes the next document's mark and code origins (`adopt_response` in `router-nav.ts` `merge_head`; the origins are read again as at boot, #1045). Only well-formed server events pass `ingest` (#879).

**Why:** Page markup (a CMS block, an HTML field rendered raw, a sanitizer that keeps scripts of a type that does not run) can carry a script of any of these types, before or after the server's. It cannot know a mark made for this response, so islands get the server's page data, remote values, context and hole endpoints, and the dock shows only what the server recorded (#881, #893).

**Do not:**

- Read a document-level channel by its type or marker alone, or read the mark from anywhere but the head runtime script.
- Put the mark after the tag's other attributes: a repeated attribute keeps its first value, so leading it beats a mark the markup wrote on the tag.
- Write a side channel of a response with another request's mark, or with none.

**Enforced by:** `packages/core/test/browser/side-channel-seeds.test.ts` (every channel, before and after, a fetched document, an unmarked one), `packages/core/test/browser/devtools-feed-own-render.test.ts` (devtools), `packages/core/test/head-presence.test.ts` (the mark on every placement), `packages/core/test/response-mark.test.ts` (one mark per response, on the holes record).

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

## Related docs

- Product vocabulary: [`DESIGN.md`](./DESIGN.md)
- Public API: docs site + [`packages/ogygia/README.md`](../../packages/ogygia/README.md)
- Spec / goals: [`SPEC.md`](./SPEC.md)
