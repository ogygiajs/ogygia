# `@ogygia/workers`: threads the compiler places

Status: **research**. Nothing here is decided, and nothing public exists. Every name below that an
app would type is a proposal and is marked **NEEDS OWNER YES**. The prototype lives in
`internal/workers-lab/` (not a package; nothing ships).

The question: can ogygia move work off the thread that is doing it today, without the app writing
worker code? Four ideas came out of the owner's research session. This note designs each one,
says how it fits the pieces ogygia already has, and measures the one that matters most on the
server (idea 1, with the slice of idea 3 it needs).

## 0. The short version

| Idea                                                  | Verdict                                   | Why, in one line                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3. `with { run: 'worker' }` for any function          | **Build it first** (internal first)       | It is the foundation of 1 and 2, and the lab shows the hard parts (chunk emit, ownership, real cancel) are small with `@ogygia/machine`.                                                                                                            |
| 1. Region renders on Node worker threads              | **Worth it, opt-in, for heavy regions**   | A light request's p99 drops from 1.9 s to 0 ms under load, one page gets 16 → 9 ms, and it matches a cluster's req/s with less memory. Light regions lose (section 9.5).                                                                            |
| 2. A browser worker as a mini server for live regions | **Narrow; later, behind 3**               | It works in all three engines, and the worker chunk is only 4.4 KB br. But the answer lands a frame later, placing the HTML still costs the main thread, and its trust root is new. It wins only for long renders of client-held data. Section 9.4. |
| 4. A service worker built from the region map         | **Separate track; reuse stitch.ts as is** | `packages/postrender/src/stitch.ts` already runs anywhere `fetch` does. The work is caching rules and security, not threads.                                                                                                                        |

## 1. Why

- A region's server render is synchronous string building. A big table or a Shiki-highlighted
  file holds the event loop for tens of milliseconds. Every other request on that process waits,
  including the light ones (a `/ping`, a hole, a redirect).
- `INVARIANTS.md` already says it (RENDER-TIMEOUT): "Svelte `render()` has no AbortSignal. Timeout
  stops _waiting_; work may continue … Isolating renders in workers is the real cancel story (out
  of default scope)." A thread is the only thing that can stop a synchronous render: you end the
  thread.
- Regions are already separate renders with serialized props. A hole renders one component by a
  signed render id with saved props (`render_region` in `packages/core/src/hooks.ts`). A held
  region renders through `render_region_html` (`packages/core/src/server/render-region-html.ts`).
  Those are jobs with a clean input (devalue-able props) and a clean output (a string). That is
  exactly the shape a thread pool wants.

## 2. Words used here

- **Thread**: a Node `worker_threads` Worker, or a browser Web Worker. Its own JS heap; it shares
  nothing with the main thread except messages (structured clone, or transferred buffers).
- **Pool**: a fixed set of threads that take calls from a queue, one call per thread at a time.
- **Call**: one function call sent to a thread. It has an **owner** (a `scope()` from
  `@ogygia/machine`): owner closes, call is `STALE`.
- **Worker chunk**: an extra entry chunk the compiler emits for a module marked
  `with { run: 'worker' }`: it imports the module and serves its exports to the pool.

## 3. Idea 3 (the foundation): `with { run: 'worker' }`

### 3.1 App code

```ts
// src/lib/markdown.ts — an ordinary module. Every export it lets cross is async.
export async function parse(source: string): Promise<Doc> { … }
export async function highlight(code: string, lang: string): Promise<string> { … }
```

```ts
// anywhere: a server load, a remote, an island, a .svelte file
import { parse } from '$lib/markdown.ts' with { run: 'worker' }; // NEEDS OWNER YES (the key and value)

const doc = await parse(source); // runs on a thread; same type as without the attribute
```

Owned calls (cancel when the owner goes away) use the owner you already have:

```ts
import { owned } from '@ogygia/workers'; // NEEDS OWNER YES (name and package)
import { STALE } from '@ogygia/machine';

const doc = await owned(m.scope, parse)(source); // a machine visit, a request, a region
if (doc === STALE) return; // the owner closed: a queued call never started; a running one is dropped
```

The rule that keeps the types honest with **no TypeScript plugin**: every export of a module marked
`run: 'worker'` that the importer names must be declared `async` (or return a `Promise`). The
compiler checks this (a build error with a code, `workers_sync_export`), so `parse` has the same
type with and without the attribute. TypeScript cannot change a binding's type from an import
attribute; this rule makes it unnecessary.

### 3.2 What the compiler emits

Server build (and the browser build, with a Web Worker in place of `worker_threads`):

```js
// the importer, rewritten
import { threaded as __og_threaded } from '@ogygia/workers/runtime';
const { parse } = __og_threaded(
	import.meta.ROLLUP_FILE_URL_ref0,      // → new URL('markdown.worker-[hash].js', import.meta.url)
	() => import('./markdown-[hash].js'),  // the inline path (dev, or no threads)
	['parse']
);
```

```js
// markdown.worker-[hash].js — an emitted entry chunk
import * as m from './markdown-[hash].js'; // a shared chunk: the module is bundled once
import { serve } from './workers-serve-[hash].js';
serve(m);
```

This is exactly what the lab's plugin emits today (`internal/workers-lab/run-worker-plugin.ts`,
Rolldown 1.2: `this.emitFile({ type: 'chunk' })` plus `import.meta.ROLLUP_FILE_URL_<ref>`, checked
in the built output). The module is one shared chunk that both the main graph's dynamic import and
the worker entry import, so it is not bundled twice; each thread does evaluate it once (its own
heap), which is the startup cost in section 8.

Dev: the attribute compiles to the inline form (a dynamic import, same thread). Running a Vite dev
module graph inside `worker_threads` is a project of its own (section 8); dev correctness does not
need it, because the call's contract (async, cloned arguments) is checked inline too: dev clones the
arguments with `structuredClone` before the call, so a value that cannot cross fails in dev, not
first in production.

### 3.3 The runtime contract (all from `@ogygia/machine`)

| Need                        | How                                                                                                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancel                      | `owned(scope, fn)` runs the call as `scope.task(signal => …)`. A queued call whose signal aborted is dropped before it starts. A running call is let finish and its answer dropped (the caller already has `STALE`). Lab: `check.ts` proves both.                                                               |
| Real cancel of runaway work | A per-call deadline. Past it the pool **terminates the thread** and respawns the slot (`workers_call_timeout`). This is the cancel RENDER-TIMEOUT says we lack. Lab: proved by `check.ts`.                                                                                                                      |
| Crashed threads             | A `policy()` decides the respawn waits (`backoffAfter`). A slot that keeps crashing stays down and says so; the others serve. Lab: proved by `check.ts`.                                                                                                                                                        |
| Same call twice             | Optional `flights()` keyed by the arguments, for pure functions marked as such (`run: 'worker', share: true`? see open questions). Never on by default: a call with side effects must run each time.                                                                                                            |
| Transferables               | The runtime walks the arguments one level and transfers an `ArrayBuffer`, a typed array's buffer, `MessagePort`, `ImageBitmap`, `OffscreenCanvas` when the caller marks it (`transfer(view)`). Not automatic: transferring empties the caller's copy, which is a behavior change the caller must ask for.       |
| Errors                      | They cross as data (name, message, stack) and become a coded error: `workers_call_failed`, `workers_thread_crashed`, `workers_call_timeout`, `workers_not_cloneable`, `workers_sync_export`, each with its `/e/<code>` page through `define_messages`.                                                          |
| Trace and devtools          | Each call emits `server` / `runtime` events on the devtools bus (`packages/core/src/events/bus.ts`): queued, started (thread id), settled (ms, bytes in/out), dropped. Inside a thread, `emit()` posts to the main thread, which `ingest()`s. Machines inside a thread report through `observe()` the same way. |

### 3.4 Integration with what exists

- **Compiler.** The attribute is read where the region attributes are: `FileCompilation` for
  `.svelte` hosts and `TsRegionCompilation` for `.ts` modules (`packages/core/src/compiler/region/
  transform.ts`; it moves to `@ogygia/compiler` with #533). `run` is **not** a region key: it must
  not enter `REGION_KEYS` / `DEFAULT_IMPORT_KEYS`, so `#resolve_region_mark` keeps returning `null`
  for it and region rules never see it. It gets its own small pass (a named import list, no default
  import, no namespace import in v1). The emit goes through the driver's injected `emitFile`
  (`EmitChunk` in `compiler/driver.ts`), like `emit_island_entry` does for islands.
- **Dynamic imports.** `import('./m.ts', { with: { run: 'worker' } })` is a build error today's way
  (the same refusal islands use for `import(…, { with: { hydrate } })`): the compiler cannot see the
  names, and a dynamic import is already async.
- **Plugin infra.** `@ogygia/workers` would be a plugin package like the others: a `definePlugin`
  build half (registers the attribute pass and emits the worker chunks), a `defineServer` half (owns
  the server pool: `setup(app)` starts it, the process owns it; `app.devtools` carries its events),
  and a `defineClient` half that is **empty at boot**: the browser pool is created by the first call
  (a conditional `import()`), so pages that never call a threaded function pay zero bytes.
- **The content search worker** (`packages/content/src/site/search-worker.ts` +
  `search-client.ts`) is the first in-repo user. Today it is a hand-written protocol (`load`,
  `query`, `ready`, `result`, `error`), a hand-written `#pending` map, and no per-query cancel. With
  the attribute it becomes `import { load, query } from './search-index.ts' with { run: 'worker' }`
  and `owned(palette_scope, query)(q)`: the protocol, the map and the lifecycle machine in
  `search-client.ts` go away, and a query whose palette closed is dropped. A good first PR: it
  deletes code.
- **`@ogygia/machine`.** Nothing new is needed. `scope().task`, `STALE`, `policy`, `backoffAfter`,
  `flights` cover the contract. One gap: `scope.task` cannot tell the work "you are now stale but
  keep your slot until you return" vs "drop it"; the pool handles that itself (section 3.3).
- **Messages.** A `packages/workers/src/messages.ts` beside postrender's, its tables added to
  `apps/docs/src/lib/messages.ts`.

## 4. Idea 1: render regions in parallel on Node threads

### 4.1 App code

Opt-in, per region, on the import that already carries the region's dials:

```svelte
<script>
	import Report from './Report.svelte' with { render: 'static', thread: true }; // NEEDS OWNER YES
	import Snippet from './Snippet.svelte' with { render: 'deferred', thread: true }; // a hole
</script>

<Report {rows} />
<Snippet {code} lang="ts" />
```

Or a whole app: `ogygia({ threads: { regions: 'heavy' } })` where "heavy" is decided by the build
from the profiler's render costs (NEEDS OWNER YES; see open question 2). Automatic for every region
is wrong: with light regions the main thread's cloning and messaging become the bottleneck, and a
wide pool falls far behind a cluster (section 9.5, point 6).

Zero browser bytes: everything here is on the server.

### 4.2 What the compiler emits

The region's server wrapper (`server_wrapper_source`, `compiler/region/emit.ts`) gets a threaded
render instead of the inline component:

```js
// the page's SSR graph: the region's body comes from a thread
import { render_on_thread } from '@ogygia/workers/server';
const __render = render_on_thread(import.meta.ROLLUP_FILE_URL_ref3, 'src/lib/Report.svelte');
// … in the wrapper: {@html await __render(props, owner)} (async SSR) or a late region (below)
```

```js
// regions.worker-[hash].js — ONE worker chunk for all threaded regions of the app
import { serve_regions } from '@ogygia/workers/serve';
serve_regions({
	'src/lib/Report.svelte': () => import('./Report-[hash].js'),
	'src/lib/Snippet.svelte': () => import('./Snippet-[hash].js')
});
```

One worker chunk for all regions (not one per region): a pool serves any region, and a thread
loads a region's code the first time it renders it.

### 4.3 Where it plugs in (each seam exists today)

| Path                                                   | Seam                                                                                   | What changes                                                                                                                                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Holes (`render: 'deferred'`), the endpoint and batches | `#render_component` in `hooks.ts` ("the ONE cache-fronted render seam")                | `render_body` posts `{ module, props }` to the pool instead of calling `render()`. `cached_render`, the render cache and the signature checks stay on the main thread, in front.                                                 |
| The render gate                                        | `render_gate` (`ConcurrencyGate`, `REGION_RENDER_CONCURRENCY = 4`)                     | The pool _is_ the gate for threaded renders: its size is the concurrency. The deadline becomes a real cancel (terminate the thread). `region_render_abandoned` stops being "work may continue".                                  |
| Held regions (`await region(C, props)`)                | `render_region_html` (`server/render-region-html.ts`)                                  | Same: `render()` moves to the pool; `islandCss(module_url)` and `region_css_tags` stay on the main thread (they read build data).                                                                                                |
| Streamed pages and late regions                        | `bake_yield`, `late_region_chunks` (`packages/router/src/stream.ts`)                   | Late regions already resolve out of order and stream in order; each one's bake goes to the pool. This is where the parallel win is free: the page shape already waits for them.                                                  |
| Stitched pages (`stitch: 'serve'`)                     | `stitch_html(html, render)` (`packages/postrender/src/stitch.ts`) via `ctx.renderHole` | Holes already render "in PARALLEL" there, but on one thread, so the parallelism is only over awaits. With the pool it is real.                                                                                                   |
| Static regions inline in the page's render             | `Region.svelte` renders `<Component …/>` in the same Svelte pass                       | The hard case. It needs Svelte's async SSR (`{@html await …}` in the wrapper), or the region turned into a late region on streamed documents. v1 should not touch it: threaded static regions become late regions on the router. |

### 4.4 What a threaded region may not do (the purity rule)

A thread has no Kit request. So a threaded region's server tree must not:

- call `requestEvent()` (ogygia), `getRequestEvent()` (Kit), read `$app/server`, or import
  `$env/*/private`;
- read `page.data` beyond what was sent (the page facts for `kit_render_context()` are serialized
  into the call: `page.url`, `params`, `route.id`, the `page.data` keys the build pinned for that
  region, which the build already knows from its `page.data` read pinning);
- rely on module-level state shared with the main thread (a cache filled by a load function).

The compiler can see most of it (its import graph walk already pins `page.data` reads and knows
server-only modules); what it cannot see is a runtime error with a code
(`workers_request_in_thread`), never a silent wrong answer. This is the biggest design cost of
idea 1, and the reason it is opt-in.

### 4.5 Output must not change

A threaded region renders as its own root. That is already true of holes and held regions (each is
its own `render()`), so their bytes do not change. The lab checks it: the page from one thread and
from a pool is byte-identical (`cmp` of the two `/page` answers; section 9.3). For static regions
moved off the inline pass the markers do change (a separate root), which is a second reason to
leave inline static regions out of v1.

## 5. Idea 2: a browser worker as a mini server

### 5.1 The idea

Svelte's server output is string building with no DOM. So the server render of a region can run in
a Web Worker. A live region could then get its next HTML from the worker instead of the server,
and the main thread only applies it through the existing answer path: parse, `answerParsed`, morph,
`answerPlaced` (the client plugin hooks on #608; the apply itself is `#morph_live` / `#apply` in
`packages/core/src/runtime/core.ts`, the morph is `morph_children` in `runtime/morph.ts`).

### 5.2 App code

```svelte
<script>
	import Preview from './Preview.svelte' with { render: 'live', where: 'worker' }; // NEEDS OWNER YES
	let source = $state('');
</script>

<textarea bind:value={source}></textarea>
<Preview {source} />  <!-- re-rendered in a worker on each change, morphed in; zero hydration -->
```

### 5.3 What the compiler emits

- A browser worker chunk with Svelte's server runtime and the region's **server** compile
  (`generate: 'server'`), served by `@ogygia/workers`' browser `serve_regions`.
- In the island that drives it: a call to the threaded render, owned by the island's scope, whose
  answer goes to the region element's apply path as if it came from the endpoint (a `LiveTick` for
  `applyLive`, or the raw-HTML path for static live regions).

### 5.4 Fit and limits

- It works in all three engines: the lab's browser probe runs Svelte's server render of the table
  region in a module worker in Chromium, Firefox and WebKit (section 9.4). Svelte's server runtime
  reaches Node only through lazy, hidden imports (`node:crypto` for hashing,
  `node:async_hooks` for async context), so it bundles for the browser as is.
- Bytes: the worker chunk is Svelte's server runtime plus the region's server code (section 9.4). It
  loads on first use, never at boot.
- Trust: HOLE-TRUST says hole HTML is trusted because a server MAC signed it. A worker answer has no
  MAC; its trust is the same as any client render of that component (Svelte escapes text; `{@html}`
  is as dangerous as in an island). So a worker answer must be its own kind of answer, never fed to
  code that assumes "signed same-origin HTML" (no page-facts scripts, no region CSS links from it).
- Purity is stricter than idea 1: no server data at all, only props the browser has.
- It loses to plain hydration for small regions: a hydrated island updates the one text node that
  changed; a worker re-renders the whole region and the morph walks it. It wins when the region is
  heavy to render and the update is coarse (a markdown preview, a highlighted editor view, a large
  sorted or filtered table the page never hydrates).

## 6. Idea 4: a service worker built from the region map

### 6.1 The idea

The build knows every region: its address shape, whether it is static, deferred or live, and its
cache dials. A generated service worker could keep frozen pages and static region answers, stitch
a page offline from what it has, and go to the network only for live and per-visitor regions.

### 6.2 Fit

- **The stitch logic is reusable today.** `packages/postrender/src/stitch.ts` is plain string and
  regex code: `find_stitch_holes`, `stitch_html(html, render)`. In a service worker `render` is
  `(endpoint) => caches.match(endpoint) ?? fetch(endpoint)`. Its only import is `escapeAttr`, which
  imports nothing. The ESI rewrite (`esi_rewrite`) is the CDN form of the same thing; the service
  worker would be the "browser edge".
- **Caching rules are the work.** Region answers are `private, max-age=30` (PRELOAD-CACHE) and their
  capability URLs expire (`regions.ttl`, CAPABILITY-URL). A service worker must honor both: a
  capability URL past `exp` is never served from cache (the server would 403 it anyway), and a
  per-visitor answer (`perVisitor`, session-bound) is dropped on logout (the session cookie
  changing). Getting this wrong shows one visitor's HTML to the next person on a shared device.
- **No threads involved.** A service worker is its own thread by nature. This idea shares only the
  build's region map and the stitch code with the others; it is a separate track.
- Prior art it should borrow from, not rebuild: Workbox's streams strategy (stitching a response
  from cached and network parts as a stream).

## 7. Prior art

| What                                       | What it does                                                   | What it lacks for ogygia                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Comlink                                    | RPC proxy over `postMessage`                                   | Hand-written worker files; no cancel, no ownership, no build step; browser-first.                                                |
| swarpc                                     | Typed RPC to workers with schemas                              | Schemas by hand; no bundler integration; no server pool.                                                                         |
| Vite `?worker` / `new Worker(new URL())`   | Bundles a worker entry                                         | You still write the protocol; one side only; in SSR builds `?worker` is browser-only.                                            |
| Stencil `.worker.ts`                       | Compiler turns a module's exports into async proxies           | Closest to idea 3. Browser only, no cancel or ownership, tied to Stencil.                                                        |
| Qwik `worker$`                             | A closure runs in a worker                                     | Closure capture rules; browser only; Qwik's optimizer.                                                                           |
| Partytown                                  | Third-party scripts in a worker with a sync DOM proxy          | Different problem (foreign scripts). Do not rebuild it; recommend it.                                                            |
| Piscina / Tinypool                         | `worker_threads` pools for Node                                | A pool, not a compiler: you write the worker file and protocol. A good engine to sit under the server runtime (open question 4). |
| SSR pools at large sites (published talks) | Whole-page SSR in a thread or process pool                     | Whole pages, not regions: no in-order streaming of parallel parts, no per-region opt-in.                                         |
| Vercel Workflow `"use step"`               | Durable, resumable steps across requests                       | A different problem (durability across time), not parallelism inside a request.                                                  |
| Workbox streams                            | Service worker that stitches responses                         | Generic; does not know regions or their cache dials. Idea 4 builds on it.                                                        |
| Microsoft WebUI                            | Server-rendered UI with a small client                         | Not about threads; shows the "server render, client applies" split that idea 2 moves into a worker.                              |
| WorkerDOM                                  | A DOM in a worker, mutations sent to the main thread           | Runs client components off thread at the cost of a DOM shim. Idea 2 needs no DOM at all: it builds strings.                      |
| TC39 module expressions, shared structs    | Language-level ways to ship code and share memory with workers | Stalled (not shipping). The design must not wait for them; when they ship they shrink the worker chunk story.                    |

## 8. Hard parts

1. **Thread startup.** Each thread evaluates its modules from scratch. In the lab one thread takes
   about 107 ms to be ready, most of it Shiki loading its grammar and WASM. A pool must start at
   boot (`setup(app)`), never on the first request. On serverless (one request per instance, cold
   starts) a pool can cost more than it saves: open question 5.
2. **Memory.** Each thread has its own heap and its own copy of every module it loads (Shiki is the
   big one). Lab: idle RSS is 0.3 GB inline, 0.75 GB with 4 threads and 2.0 GB with 15. That is still
   less than a cluster of the same width (1.3 GB for 4 processes, 5 GB for 16).
3. **Duplicated shared chunks.** The bundle is not duplicated (one shared chunk), but evaluation is,
   once per thread. Module-level caches (a highlighter, a compiled regex table) are per thread: a
   cache that must be shared needs to live on the main thread or be rebuilt.
4. **Vite dev.** Dev SSR runs through Vite's module runner in the main thread. A `worker_threads`
   Worker cannot import from that graph. Options: inline in dev (the proposal: same contract,
   structured-clone check, no threads), or a module runner per thread talking to the dev server
   (possible with Vite's environment API, but every edit invalidates N graphs). v1: inline in dev.
5. **Bundling.** Rolldown: `emitFile({ type: 'chunk' })` + `import.meta.ROLLUP_FILE_URL_<ref>`
   works (the lab builds with it). In Kit's SSR build the chunk lands in `output/server` and the
   adapters copy it. `adapter-vercel` traces files with nft, which follows
   `new URL('x.js', import.meta.url)`; to verify on a real deploy before relying on it.
6. **Serialization.** Props already cross by devalue for holes. Structured clone is close but not
   the same: it keeps `Date`, `Map`, `Set`, `BigInt`, typed arrays, but drops class identity,
   functions and `[ogygia.wire]` codecs. A threaded region's props go through the same devalue the
   hole capability uses (so the wire codecs and the transport work), as a string; the lab measures
   the clone cost inside its latency numbers.
7. **Runtimes without threads.** `adapter-node`, Vercel's Node functions, Netlify functions, Bun
   and Deno have threads. Edge runtimes (Vercel Edge, Cloudflare Workers) do not. There, every
   threaded call runs inline: same output, no win. The runtime chooses at start, never per call.
8. **Security of signed props.** A hole's props are signed because they came back from the browser.
   A threaded render's props never leave the server: they go main thread → thread inside one
   process, so no MAC is needed for idea 1. Idea 2 is the opposite: the props are the browser's own,
   so its answers are unsigned client renders (section 5.4). Idea 4 caches signed answers and must
   respect their expiry and their visitor binding (section 6.2).
9. **Ordering and back pressure.** A pool has a queue. Under overload the queue grows; it needs the
   same deadline the render gate has (a queued render past the deadline never starts; the hole keeps
   its fallback), and a cap (beyond it, render inline or answer the fallback).
10. **Observability.** Profiler CPU profiles today cover the main thread. Threaded renders need the
    thread's own profile (`Session` per worker) or the profiler's region costs go blind.

## 9. Prototype: idea 1 with the slice of idea 3 it needs

### 9.1 What was built (`internal/workers-lab/`)

- `run-worker-plugin.ts`: the compiler slice. A Rolldown plugin that rewrites
  `import { … } from './m.ts' with { run: 'worker' }` into the threaded proxy and emits the worker
  chunk (section 3.2 is its real output).
- `src/thread.ts` + `src/thread-worker.ts`: the runtime slice. A `worker_threads` pool: one call per
  thread, a queue, `owned(scope, fn)` (a queued call whose owner closed never starts and the caller
  gets `STALE`), a deadline that terminates the thread, crash respawn by a `policy()`, coded errors.
  `LAB_THREADS=0` runs every call inline (the dev and no-threads path).
- `src/jobs.ts`: one region render by name, `async`, the module marked `run: 'worker'`.
- `src/page.ts` + `src/server.ts`: the fixture page (two tables of 600 and 400 rows, two
  Shiki-highlighted TypeScript sources of 250 and 150 lines, a light shell; 346 KB of HTML at scale 1)
  streamed in document order on a plain `node:http` server. Each region is its own `render()`, as
  holes and held regions are in ogygia; the regions start together and are written in order.
- `src/check.ts`: the behavior claims of section 3.3, run on real threads (`pnpm check:threads`).
- `bench.ts`: the load test. `browser-probe.ts`: idea 2's numbers in real browsers.

Why not inside a Kit fixture app: the question is "does moving a region's `render()` to a thread
pay", and a plain server measures that without Kit's own per-request cost diluting it. The seams in
section 4.3 are where the same pool would plug into ogygia; the render inside the thread is the same
`render()` call.

### 9.2 How to rerun

```bash
cd internal/workers-lab
pnpm build                     # dist/: the server, the worker chunk, the check
pnpm check:threads             # the behaviors in 9.1, on 2 threads
pnpm bench                     # the full matrix (about 30 min), writes results.json
node bench.ts --quick          # 3 s runs, 3 shapes: a smoke test
node bench.ts --only inline,pool-4
pnpm probe:browser             # idea 2: worker chunk size, worker start, render in a worker
```

Shapes: `inline` (one thread, as ogygia renders today), `pool-N` (the main thread plus N render
threads), `cluster-N` (N processes, each inline: how apps use every core today, and the baseline a
pool must beat). Scales: the page's work times 0.1 (light regions), 1, 4. Concurrency: 1, 4, 16, 64
connections to `/page` for 10 s after a 3 s warmup, while a second client asks `/ping` 50 times a
second on its own connection: its latency is what one heavy page costs everyone else on the
process. Loop delay is `monitorEventLoopDelay` minus its 5 ms tick.

### 9.3 Numbers

Apple M4 Max (16 cores: 12 performance, 4 efficiency), 64 GB, Node 26.4.0, macOS. The load
generator (autocannon, one process) runs on the same machine, so the 15- and 16-wide shapes share
cores with it. Their numbers are lower bounds. Every row is in `internal/workers-lab/results.json`.
`/ping` is the light request beside the load. Its p99 is what heavy pages cost everyone else.
Loop delay is the main thread's (for clusters it is one of the processes).

**Scale 1** (the page as built: 4 heavy regions, about 16 ms of render on one thread):

| shape      | conns | req/s | p50 ms | p97.5 | p99  | /ping p99 | loop p99 ms | RSS MB |
| ---------- | ----- | ----- | ------ | ----- | ---- | --------- | ----------- | ------ |
| inline     | 1     | 59.5  | 16     | 20    | 21   | 17        | 16          | 305    |
| pool-4     | 1     | 100   | **9**  | 11    | 13   | 0         | 1.1         | 751    |
| cluster-4  | 1     | 56.3  | 17     | 21    | 22   | 0         | 15          | 1451   |
| inline     | 16    | 61    | 244    | 498   | 685  | **1860**  | 263         | 299    |
| pool-4     | 16    | 211.3 | 75     | 80    | 81   | **0**     | 1.0         | 814    |
| cluster-4  | 16    | 208.9 | 59     | 134   | 137  | 77        | 71          | 1313   |
| pool-15    | 16    | 524   | 30     | 37    | 39   | 3         | 2.1         | 2495   |
| cluster-16 | 16    | 465.5 | 31     | 59    | 69   | 70        | 39          | 5575   |
| inline     | 64    | 60.6  | 426    | 2749  | 6472 | timed out | 563         | 303    |
| pool-4     | 64    | 212.7 | 300    | 306   | 307  | 0         | 1.0         | 806    |
| cluster-4  | 64    | 208.4 | 285    | 586   | 1226 | 2144      | 289         | 1233   |
| pool-15    | 64    | 511.4 | 123    | 140   | 149  | 3         | 2.8         | 2502   |
| cluster-16 | 64    | 496.4 | 115    | 270   | 309  | 376       | 116         | 5215   |

**Scale 4** (very heavy regions, about 70 ms of render per page):

| shape      | conns | req/s | p50 ms | p99 | /ping p99 | RSS MB |
| ---------- | ----- | ----- | ------ | --- | --------- | ------ |
| inline     | 1     | 14    | 69     | 85  | 107       | 353    |
| pool-4     | 1     | 24.3  | **40** | 55  | 0         | 693    |
| cluster-4  | 4     | 50.4  | 77     | 95  | 88        | 1390   |
| pool-4     | 4     | 49.9  | 78     | 97  | 0         | 982    |
| pool-15    | 16    | 120   | 129    | 185 | 7         | 2886   |
| cluster-16 | 16    | 136   | 113    | 188 | 202       | 5434   |

**Scale 0.1** (light regions, about 2 ms per page: the case where threads should not win):

| shape      | conns | req/s  | p50 ms | p99 | /ping p99 | RSS MB |
| ---------- | ----- | ------ | ------ | --- | --------- | ------ |
| inline     | 16    | 504.1  | 29     | 62  | 204       | 442    |
| pool-4     | 16    | 1639.2 | 9      | 13  | 0         | 779    |
| cluster-4  | 16    | 1825.7 | 7      | 16  | 16        | 1624   |
| pool-15    | 64    | 1349.2 | 47     | 52  | 0         | 2093   |
| cluster-16 | 64    | 4904.8 | 10     | 42  | 31        | 6180   |

**Startup.** A thread is ready about 107 ms after `new Worker` (Shiki's grammar and WASM are most of
it). Booting a server with its pool warm: 73 ms inline, 117 ms with 4 threads, 205 ms with 15.

**Output.** The page from `LAB_THREADS=0` and from a pool is byte-identical (346,337 bytes, `cmp`).

**Behaviors** (`pnpm check:threads`, all pass): calls run side by side on different threads. An
owner that closes gets `STALE` at once, and its queued call never starts. An error crosses as a
coded error with the worker's stack. A worker that dies fails its call, and the slot comes back. A
call past its deadline terminates its thread, and the slot comes back.

### 9.4 Browser probe (idea 2)

`pnpm probe:browser`, headless, same machine. It uses the 600-row table region (146 KB of HTML),
and each timing is the median of 30 runs.

| engine   | worker start | render, main thread | render + place, main thread | render in worker | worker round trip + place | main thread busy placing it |
| -------- | ------------ | ------------------- | --------------------------- | ---------------- | ------------------------- | --------------------------- |
| Chromium | 3.7 ms       | 1.0 ms              | 2.9 ms                      | 1.2 ms           | 17.1 ms                   | 3.2 ms                      |
| Firefox  | 8 ms         | 1 ms                | 4 ms                        | 1 ms             | 18 ms                     | 4 ms                        |
| WebKit   | 8 ms         | 2 ms                | 5 ms                        | 1 ms             | 27 ms                     | 7 ms                        |

- **Bytes.** The worker chunk is 4.4 KB brotli: Svelte's server runtime plus the table's server
  code, built whole with no shared chunk. That is small.
- **The render is cheap; placing it is not.** The browser builds the table's string in about 1 ms.
  Parsing and placing 146 KB of HTML costs the main thread 3 to 7 ms either way, and a worker cannot
  take that part.
- **A worker answer lands a frame later.** The round trip is 17 to 27 ms, against a 1 ms render. The
  answer arrives in a later task, usually after a frame. The main thread is free meanwhile, but the
  update is a frame late.
- So idea 2 pays only when the render itself is long (tens of ms, like Shiki or markdown on a big
  input) and the region is not hydrated. For a table this size, render on the main thread or
  hydrate it.

### 9.5 Reading the numbers

1. **The event loop stays free. This is the big win.** With heavy regions inline, a light request
   waits behind them: `/ping` p99 is 1.9 s at 16 connections, and at 64 it does not answer within
   autocannon's timeout. With a pool, `/ping` p99 is 0 to 10 ms at every load, and the loop's p99
   delay stays near 1 to 3 ms. A cluster does not fix this. Each process is still one thread, so its
   `/ping` p99 is 77 ms to 2.1 s. This is the RENDER-TIMEOUT problem, measured.
2. **One request gets faster.** A page's regions render side by side. At 1 connection, p50 drops
   from 16 to 9 ms (scale 1) and from 69 to 40 ms (scale 4). No cluster can do that. A process
   renders one page's regions one after another.
3. **Throughput per core is about the same as a cluster for heavy regions.** pool-4 does 212 req/s
   and cluster-4 does 208. pool-15 does 524 and cluster-16 does 466 (scale 1). At scale 4, cluster-16
   is ahead, 136 to 120. Threads add no raw CPU. They add parallelism within a request and keep the
   main thread free.
4. **Tails are much tighter.** The pool is one FIFO queue in front of all threads. A cluster
   spreads connections over processes, and one unlucky process piles up. At scale 1, 64
   connections: pool-4 p99 is 307 ms and cluster-4 is 1226 ms. pool-15 is 149 ms and cluster-16 is
   309 ms.
5. **Memory is lower than a cluster.** At about the same throughput, pool-4 uses 0.8 GB and cluster-4
   uses 1.3 GB. pool-15 uses 2.5 GB and cluster-16 uses 5.2 GB. A thread still costs about 100 MB
   here, because each one loads Shiki: idle RSS is 0.3 GB inline and 2.0 GB with 15 threads.
6. **Light regions lose at high width.** At scale 0.1, the main thread becomes the bottleneck: it
   clones props, posts messages and writes the page. pool-15 tops out at 1349 req/s and cluster-16
   reaches 4905. pool-4 still beats inline (1639 against 504), but it trails cluster-4 (1825). This
   is why regions must not move to threads automatically, and why the best production shape for
   heavy pages is probably **a few processes, each with a small pool**. That shape was not measured
   here (see the plan).
7. **The cost is startup and memory, not bytes.** A thread is ready in about 107 ms, and a pool must
   start at boot. Zero browser bytes.

Verdict for idea 1: **worth building, opt-in per region**. It fixes the event-loop blocking that
inline rendering and clusters both have. It halves single-request latency for pages with several
heavy regions. It matches a cluster's throughput with less memory. It also gives renders a real
cancel. It is not a general throughput tool for light pages.

## 10. Proposed public surface (NEEDS OWNER YES, every line)

Nothing below exists. Each is a proposal to accept, rename or drop.

| Surface                                    | Kind                  | Proposal                                                                                                                                              |
| ------------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ogygia/workers`                          | package               | The plugin package (build, server and client halves).                                                                                                 |
| `with { run: 'worker' }`                   | import attribute      | Idea 3. Key `run`, value `'worker'` (room for `'inline'` to force inline in a test).                                                                  |
| `owned(owner, fn)`                         | export                | An owned call; `STALE` when the owner closes. Works on plain functions too.                                                                           |
| `transfer(value)`                          | export                | Marks a buffer to transfer instead of clone.                                                                                                          |
| `with { thread: true }` on a region import | import attribute key  | Idea 1, per region.                                                                                                                                   |
| `workers({ threads, deadline, regions })`  | plugin options        | Pool size (default: cores − 1 on the server, 0 on edge runtimes), the call deadline, and `regions: 'marked'                                           | 'heavy'`. |
| `with { render: 'live', where: 'worker' }` | import attribute key  | Idea 2.                                                                                                                                               |
| `workers_*` message codes                  | message codes         | `workers_call_failed`, `workers_thread_crashed`, `workers_call_timeout`, `workers_not_cloneable`, `workers_sync_export`, `workers_request_in_thread`. |
| A generated service worker                 | build output + option | Idea 4, a separate proposal.                                                                                                                          |

## 11. Open questions (each needs the owner)

1. **The attribute's name.** `run: 'worker'` (reads as a sentence; room for other values) vs
   `thread: true` (one word for ideas 1 and 3) vs `worker: true`. Recommendation: `run: 'worker'`
   for functions and `thread: true` on region imports is two names for one idea; better is one key
   for both, `run: 'worker'`, which on a region import means "render it on a thread".
2. **Opt-in or automatic for regions.** (a) marked regions only; (b) the build marks regions whose
   profiled render cost is over a threshold; (c) every region. Recommendation: (a) in v1, (b) later
   from the profiler's data. (c) is wrong: light regions get slower (section 9.5).
3. **Where the server pool lives.** (a) in `@ogygia/workers`, core asks it through a plugin hook
   around `render_body`; (b) in core, folding `ConcurrencyGate` into the pool. Recommendation: (a)
   first: core gets one plugin hook ("render this region") and the pool stays out of core's size
   and of apps that do not use it. This hook is plugin API (internal), so it needs no public yes.
4. **Own pool or Piscina/Tinypool underneath.** Recommendation: own pool. It is ~250 lines in the
   lab, and ownership, `STALE` and deadline-terminate are the parts the libraries do not do our way.
5. **Serverless.** On a cold start the pool's boot is paid by the first request. Options: no pool on
   serverless (detect it), a pool of 1 started lazily, or leave it to the app. Recommendation: the
   plugin option's default is "no threads" when the adapter is a serverless one, with a message that
   says why.
6. **Idea 2's trust model.** A worker-rendered answer is an unsigned client render. Recommendation:
   it gets its own apply path that refuses page-facts scripts and CSS links, and docs that say
   "same trust as an island".

## 12. Staged plan

1. **Internal `run: 'worker'` (no public surface).** Compiler pass + runtime in a private module;
   convert the content search worker to it (deletes its protocol). Rules: the async-export check,
   the structured-clone check in dev. Size: zero at boot (first call imports the pool).
2. **Two more measurements before building idea 1 for real.** (a) The same page in a Kit fixture
   on `adapter-node`, with the pool behind `#render_component`, to see Kit's per-request cost
   beside the render. (b) The "few processes, each with a small pool" shape (for example 4 × 3),
   which the numbers point to as the best production shape.
3. **Server pool behind a plugin hook.** The "render this region" hook in `#render_component` and
   `render_region_html`; the pool owns deadlines with a real cancel. Byte-identical checks of hole
   and held-region answers with and without threads (the twin check). Ask the owner for idea 1's
   public dial.
4. **Router late regions on threads.** The free win: late regions already stream in order.
5. **Profiler + devtools.** Per-thread CPU profiles; call events on the bus; the "heavy region"
   insight that suggests `thread: true`.
6. **Idea 2**, only if a real app asks for it, after 1 to 5.
7. **Idea 4** as its own proposal, reusing `stitch.ts`.
