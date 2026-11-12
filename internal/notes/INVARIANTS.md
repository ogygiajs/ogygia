# Ogygia invariants

Why certain designs exist — and what breaks if you “simplify” them.
Security and performance audits should read this before changing trust boundaries.

Every section ends with an `**Enforced by:**` line: the rules (`rule_…`), lint rules (`ogygia/…`),
tests and checks (`path` or `path > name`) that fail when the invariant breaks. CI fails a section
with no line, or a line naming something that does not exist (`internal/checks/invariants.ts`).

---

## HOLE-TRUST — signed same-origin HTML for deferred regions

**What:** The runtime fetches a capability URL and inserts HTML parsed in one place (`runtime/parse-html.ts` `parse_region_html`: `setHTMLUnsafe` on a template of an inert document, so declarative shadow roots attach) and grafted or swapped in (`replaceChildren`). Scripts in that HTML do **not** run; event-handler attributes would.

**Why:** Deferred / SWR regions are MPA-equivalent: the HTML is produced by _our_ SSR under a verified HMAC. Trust root is the **server MAC**, not the client.

**Do not:**

- Pipe hole HTML through a generic sanitizer (DOMPurify etc.) without allowing `ogygia-region` and lake structure — it silently breaks holes.
- Treat absolute `endpoint` URLs as a primary XSS bug; mint always emits a **path-only** URL. The client same-origin check is defense-in-depth for prior HTML injection.

**Client check:** `is_allowed_region_endpoint` + final `response.url` origin. Abort in-flight fetches on disconnect.

**Enforced by:** `packages/compiler/test/audit-fixes.test.ts > allows same-origin relative and absolute; rejects cross-origin`

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

**What:** `virtual:ogygia/secret` is `''` on the client; sign/verify stubs no-op. SSR uses `OGYGIA_SECRET` or a per-build baked fallback. Sign/verify **HKDF-derive** a MAC key (`ogygia-mac-v1`); when `OGYGIA_SECRET` is set, region ids use a separate HKDF salt (`ogygia-id-salt-v1`). Capability MAC messages are `v1|` + UTF-8 length-prefixed fields (not raw `\0` concat). Production builds reject an `OGYGIA_SECRET` shorter than 16 UTF-8 bytes.

**Why:** Browsers must never mint capabilities. Multi-instance deploys without a shared env need the baked fallback so all replicas agree. Domain-separated keys + length-prefixed fields close classic MAC footguns without requiring the env var on every local demo.

A client build fails (`secret_in_client_chunk`) when a chunk or asset holds a signing secret, or a chunk holds a module that signs. Messages are `v2|` (the render id signed too) for every current mint of a hole that does not wake, and `v3|` (the "wakes" mark `w=1` signed too, so the endpoint renders the answer inside an island, as its hydrate does) for one that does; `v1|` is still verified so pages cached before an upgrade keep their holes.

**Do not:** Embed the real secret in a client chunk. Fail production builds only when you are ready to require env everywhere (local demos still need the fallback). Change the MAC version string without a deliberate invalidate of in-flight capability URLs.

**Enforced by:** `packages/compiler/test/region-mac.test.ts > length-prefixes so embedded nulls cannot shift field boundaries`, `packages/core/test/signing-key.test.ts > falls back to the build key without a runtime OGYGIA_SECRET`

---

## PROBE-THEN-RENDER — rate limit ordering

**What:** Pre-HMAC probe limiter → verify MAC → render limiter → render (with process concurrency gate). The same order holds for each hole of a batch POST: every hole is probed, verified and charged on its own, and one call asked twice in a batch renders once.

**Why:** Forged floods must not burn render CPU or reveal id existence (uniform 403). A batch must not buy more renders than the same holes asked one by one.

**Do not:** Charge the render budget before verify. Charge a batch once for all its holes. Trust `X-Forwarded-For` when `getClientAddress()` fails — fail closed (429).

**Enforced by:** `apps/palaestra/e2e/region-rate.spec.ts > a forged flood is all 403, never 429, and a valid request still serves after it`, `packages/compiler/test/audit-fixes.test.ts > documents render-rate contract: junk must not call render limited()`

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
- Skip `clear_route_csr_cache()` on dev route-topology changes — the watcher covers `+page/+layout(.server).(svelte|js|ts)`.

**Enforced by:** `packages/compiler/test/route-csr.test.ts` (declaration forms × chain shapes × layout folds × cache, plus the transform strip/keep seam), `apps/palaestra/e2e/deep-csr.spec.ts` (real build of internal/repro-deep-csr, browser truth in both worlds).

---

## CONTEXT-CURSOR — one slot for the region being hydrated

**What:** The region the runtime is hydrating (the anchor a cross-island `context.get()` walks up from) and the foreign island it is delegating to another build (`set_foreign_hydrate`) each live on one `globalThis` slot under a `Symbol.for` key (`packages/core/src/current-region.ts`). The runtime writes them; the context feature and the `$app/*` shims read them.

**Why:** The context feature is bundled apart from the runtime, and a federated island's build is another bundle again: each has its own copy of the module. A module-level variable would be one slot per copy, so the reader would see `null` while the runtime is hydrating, and a nested `get()` would find no context.

**Do not:** Keep the cursor in a module variable or behind an import the other bundle does not share. Move it into a module with heavy imports (it lives alone so the boot stays small).

**Enforced by:** `packages/core/test/current-region-slot.test.ts > two copies of the module share the region being hydrated, and the foreign island`

---

## Related docs

- Product vocabulary: [`DESIGN.md`](./DESIGN.md)
- Public API: docs site + [`packages/ogygia/README.md`](../../packages/ogygia/README.md)
- Spec / goals: [`SPEC.md`](./SPEC.md)
