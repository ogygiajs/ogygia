# Deterministic simulation (DST)

One seed drives a whole ogygia app: its servers, its visitors' tabs, the network between them, the
CDN, deploys and time. A failing seed replays the same run, step for step. This note says how it
works, what is built, and how to add to it.

## The layers

1. **Ports** (`packages/machine/src/ports.ts`). Every source of nondeterminism a package reaches
   goes through a port: `clock` (mono, wall), `timers`, `tasks` (micro, frame, idle), `random`,
   `net` (fetch, stream), `seen` (IntersectionObserver), `storage`. The lint rule `ogygia/ports`
   (internal/lint/plugin.ts) refuses a raw call in package source. A raw call that must stay says
   why: `// port-ok: <why>`. Build-time code (compiler, Vite plugins, CLI, test tooling) is out of
   scope (`.oxlintrc.json`), and so is devtools for now (an instrument the simulated apps do not
   turn on; to fold in).
   - A port reads its realm's platform when called. The simulator gives each realm (a tab's
     document, the server host) a simulated platform, so ogygia's calls and Svelte's and Kit's
     beside them all play the seed. A port that swapped only ogygia's calls would leave Kit's real.
   - `Platform` (ports.ts) is the contract; `internal/sim/src/platform.ts` implements it.
   - Dynamic `import()` is not a port: a tab's module loader fetches chunks over the simulated
     network.
2. **The world** (`internal/sim`, private, never published; it is a workspace member under
   `internal/` like the other repo tooling, not a package anyone installs).
   - `rng.ts`: sfc32 streams, forked by name, so a new draw in one place does not move the others.
   - `loop.ts`: one event loop on virtual time for every realm. Tasks due at once in several realms
     run in the seed's order; inside one realm they keep FIFO order. `settle()` lets real work that
     the simulator does not own (a module compile, a server's file read) finish between tasks.
   - `platform.ts`: a realm's simulated time (epoch + virtual ms + skew), timers, frames (16 ms),
     idle callbacks, randomness, crypto bytes, and a MessageChannel on the loop.
   - `network.ts`: in memory, on the loop, adversarial: delay, reorder, drop, duplicate, cut a body
     midway, tamper with bytes, redirect a region's request to another origin, stall an answer 10 to
     40 s before it starts or, half the time, after its body's first piece (past a client's own
     deadline; its own swarm stream, 30% of runs), offline, and `down`: a peer served at two origins
     answers 500 or 503 at its first. A GET it answered excuses nothing: the app owes the next
     origin's answer, so a page whose only failed hops were such GETs is judged whole (a stalled hop
     beside it still excuses the app's 504). The MPA check reads the replica as its first origin
     (its files, and a region sheet lifted beside the same file at the first: `replicas_as_one`).
   - `server.ts`: a built Kit app (`.svelte-kit/output`) served in process, static files plus
     `Server.respond`. Each instance loads its own copy of the output (its own module graph), placed
     beside the app's output so it resolves the app's dependencies.
   - `browser.ts`: happy-dom browsers, one per visitor (own cookies), with tabs, back, forward,
     reload. Each document is its own realm (`tab-2#3`), so its timers die with it, and a
     document the tab has left hears nothing more from the network (`Network.leave`: a browser
     calls off its fetches as it unloads it; a left document's stalled chunk once ran over its
     closed window, gen 192, seed 11). An `import()` its unload failed never settles (Kit's boot
     awaits its entry files with no catch, and the host heard the failure; palaestra seed 20004).
   - `world.ts`: ties it together. `World.make({ seed, builds })`, `world.go(tab, 'goto', '/')`.

## Why happy-dom

It is the only usable DOM library that has tabs, history, a cookie jar, a fetch we can intercept,
a hook before a document's first script (where the simulated platform is installed), and runs
module scripts with dynamic `import()`. jsdom is closer to the spec in its parser but runs no
module scripts. Its gaps are handled in the sim, with no patch to happy-dom:

- Its module compiler is regex-based: it turns imports into copies, not live bindings (Svelte's
  `component_context`, read across chunks, goes stale and islands fail to hydrate), and leaves
  `import.meta` raw after `return` or `?`. So a simulated document's modules run in V8 instead
  (`src/modules.ts`): each is a `vm.SourceTextModule` in the window's own context, its source
  fetched over the simulated network. Only happy-dom's compile step is replaced, in the sim's
  process. `test/modules.test.ts` holds both cases (happy-dom's compiler gives `"0   "`, V8 gives
  the live `1` and three URLs). Needs `node --experimental-vm-modules`.
- It has no MessageChannel: the sim gives each document one on the loop.
- A module graph is fetched whole before V8 links it (a failed download fails that graph and
  leaves its other modules usable, as in a browser; `test/modules.test.ts`).
- Its parser cut a run of text at a bare `>` into two text nodes, and Svelte's hydration found a
  node left over: a run is one node (`whole_text_runs`, `test/parser.test.ts`).
- It hands an intercepted answer back as it is: the sim follows a redirect itself, each leg a
  request on the network, and the answer carries its URL (`test/redirect.test.ts`).
- Its module map and the V8 loader's were two: an import asked the network for a module a
  `modulepreload` was still downloading (the runtime's script comes before its preloads, so every
  runtime chunk was asked twice). An import waits for happy-dom's download and takes its source
  (`downloading` in `src/modules.ts`, `test/modules.test.ts`; found by the differential).
- It lays nothing out, and its IntersectionObserver is a stub that never reports: no
  `wake: 'visible'` island ever woke by being seen, and the hydration drain waited for a viewport
  snapshot on every turn. A document has a layout (`src/layout.ts`: block flow on the player's
  1280x720 viewport, read off happy-dom's computed styles: display, margins, borders, padding,
  height; text 8 px a character, 20 px a line) and an IntersectionObserver that reports from it at
  a frame, a task of its realm (`test/layout.test.ts`; found by the differential). The home page's
  regions land within 70 px of Chromium's. Never scrolled yet.
- It ran an inline module script at once and an external one when its file came: a document's
  module scripts run in its order (`modules_in_order`, `test/modules.test.ts`).
- It read `interactive` from the start, never fired DOMContentLoaded, and fired `load` before a
  document's module script had run: a document reads `loading` while its parser runs, then
  `interactive`, fires DOMContentLoaded (a task of its own) once the module scripts its parser put
  in it ran, and only then `load` (`content_loaded`, `test/modules.test.ts`). A script waiting for
  DOMContentLoaded never ran (gen third party's repair mutants all survived), and ogygia's wake
  gate waited for `load`.
- It let a navigation land after the tab had started another: the first page's stalled body was
  written over the newer page, under the first page's URL. A navigation whose document has not
  come is called off when the tab navigates again (its realm is left, its failure unsaid;
  `Browsers.#start`, `test/superseded-navigation.node.test.ts`; palaestra seed 122). The page's
  own navigations too (`location.assign`, a form's submit: every start goes through
  `navigation_starts`), and the one called off never was an entry: happy-dom adds a navigation's
  entry as it starts, a browser once its document comes, so its history is put back and a back goes
  back from the page on screen (the router handed a click to the browser, the visitor went back,
  and the stalled page landed on the back's document: palaestra seed 20958,
  `rule_address_bar_drift`).
- It called only a window's bubbling `load` listeners (one that captures never heard it) and never
  fired `pageshow`: both reach the window, capturing then not, the document their target
  (`window_load_events`, `test/modules.test.ts`; found by the differential).
- It ran a copy of any script: a copy carries "already started" (a script that connected, or one a
  parser marked unexecutable), so the router's head merge ran the next page's early hole start
  again (`scripts_start_once`, `test/scripts.test.ts`; gen 191).
- Its console's methods read private fields, so a document's own console (which tells one
  document's words from another's) runs each on the page's console (`test/console.test.ts`).
- Its `document.getElementsByTagNameNS` read the document's owner document (it has none) and
  threw: the search from a document reads the document as its own owner
  (`documents_by_namespace`, `test/document.test.ts`).
- It hands every window Node's one `performance` (so every tab read the newest document's clock,
  and the host's entries), records no resource timing and has no navigation entry, and its
  `PerformanceObserver` is the host's. So ogygia's import-again never learned whether a failed
  chunk's own file came, its critical wait never read a preload's arrival, and its paint gate
  never read when DOMContentLoaded ended. Each document gets its own `performance` and observer
  (`src/timeline.ts`, `test/performance.test.ts`): its clock from its navigation's start, a
  navigation entry stamped as its parse and events run, user timing, and a resource entry per
  download once its body came, read the seed's engine's way (`timeline engine`): `status`
  (Chromium, Firefox: every download an entry with its `responseStatus`, a dropped one 0) or
  `start` (WebKit: no status, no entry for a dropped download). Observer callbacks are tasks of
  the document.
- It loads no image by default: every image read `complete` at once, and the critical wait (an
  incomplete `img[fetchpriority=high]`) was never seen. Images load over the simulated network
  (`enableImageFileLoading`, `test/images.test.ts`); the waste oracle leaves them out, as the
  document's image cache keeps one.
- `element.click()` sends only the click: a visitor's click (`user_click`) sends pointerdown,
  mousedown, pointerup and mouseup first, as a browser does (the critical gate listens for the first
  input; `test/workload.test.ts`). The real-browser player's clicks send the same.

Differences in the DOM engine cancel out for the MPA-equivalence oracle (both sides run in it);
the real-browser tier reruns interesting seeds in Chromium, Firefox and WebKit.

## Known limits

- Server instances of one world share this process's globals, except the `Symbol.for` registry:
  each instance has its own (`own_symbols`), so ogygia's slots there (its request context, signing
  key, caches, plugin hooks) are each instance's, as on two machines. One registry for all once
  let one instance's hooks answer for the other's renders (a hole's `pv=` came and went). State
  pinned to `globalThis` under a string is still shared. What a world's servers pin there is taken
  off when the world ends, so the next world in the process starts from nothing. A server's timer
  runs in the context it was set in (its instance, its clock skew), as Node's own do.
- A built app is loaded with Node's own `require` (of ESM), not `import()`, so vitest's module
  runner does not load it a second way (under it, the server's first request never answered).
- Nothing is garbage collected in a run (`WeakRef` holds, no finalizer runs): collection happens
  on the host's real schedule, so it would not replay.

## Waiting for real work

The loop never waits a fixed number of turns. `settle()` turns the host's own loop until
`process.getActiveResourcesInfo()` shows nothing in flight (no immediate, no file or crypto
request; the host's own real timers are counted, not waited on). A settle waits up to 10 s of real
time (`settle_ms`), never a count of turns: 10,000 quick turns were about 145 ms, less than a file
read on a loaded CI runner, and the run went on without it (#1612). One that gives up is a finding
(`settle-stalled`, with when and what it waited on): from there the run is not its seed's. An async
crypto job (`crypto.pbkdf2`) is not in `getActiveResourcesInfo()`, so a settle cannot see it. Everything else a page waits on is a loop task, so the
world is AT REST when nothing is on the network and nothing is due within 2 s (`World.quiesce`).
A live answer (a body still coming 30 s after its head, each piece within 2 s of the last) is not
work in flight: rest waited budget after budget on one, once to the run's horizon (palaestra seed
20003, `Network.busy`).
A server's own `fetch` goes through the world too (its own origin to the front door, any other
host fails), so no run touches the real network.

## Replay

`pnpm sim --seed X` replays one seed; `--step N` stops after action N and prints the loop's log.
Every seed runs twice, the second time in another worker process, and the two traces (every loop
task, every action, each tab's URL, DOM fingerprint and what it holds, what broke) must be equal
byte for byte: a difference is a nondeterminism leak, fixed before any finding is trusted.
`SIM_SITES=1` labels each timer and listener with the code that set it, to find one.
`SIM_STACKS=1` puts the stack of each uncaught error, console warning and console error in what the
page said. `SIM_DUMP=<dir>` writes both sides of an MPA difference whole, past its first hunk.

## A run

Each seed draws its own world (swarm testing): a subset of the fault classes, and one server or
two behind the front door (each request to the seed's pick), their clocks up to 5 s apart. The
visitor's workload (`workload.ts`): click links, go to a path, back, forward, reload, open a tab,
go offline and back, wait, and press a button in a region (woken or not yet: a press before an
island's code came is replayed once it wakes). And three shapes: `away` (follow a link, stay 10 to 50
s, go back: under the 60 s the frame store keeps a left page's answers), `hurry` (click a link, then
another 0 to 300 ms later: a navigation called off midway), `hover` (point at a link or a region:
the router warms the link's page, an island's code is warmed on intent) and `eager` (go to a page
and press a button 0 to 300 ms after its document is in, `World.start`: an input before the first
paint or during the wait for the page's critical resources; the document it presses in is the
visitor's, as a press's). A press makes every tab's document the visitor's
own state, so the MPA check skips each such document (its next one is clean), and the element
count leaves it out of the leak check.

## Deploys

`pnpm sim:builds` builds the app twice (`src/builds.ts`, both rules builds) into
`.svelte-kit/sim-builds/{v1,v2}`; palaestra's Counter renders `VITE_SIM_BUILD`, so the two differ
in code and HTML as two releases do. Each build's Kit version is its id (the apps' configs read
`VITE_SIM_BUILD`; the generated peer's is `peer`), so a rebuild of the same code is the same world:
Kit's own version, the build's moment, renamed every chunk it reaches, each request drew another
fate, and a seed ran another run on each rebuild (`test/builds.test.ts`). With both there, a run starts on v1 and the workload may
`deploy` v2 (rarely: it is the operator's action, not a visitor's). Without them a run has its
one build and never deploys. How a deploy goes out is the seed's (`Rollover`): at once, or rolling
(for 10 s a request reaches either build, by even odds); the old build's content-hashed files kept
by the host or gone with it; the CDN purged or not. And whether the app set a stable
`OGYGIA_SECRET` (most runs): without one each build signs with its own key.

What is not a file (a page, a hole, an endpoint) is answered by whichever build is live when it is
asked: a hole an old page fetches after a deploy is the new release's. The front door marks each
answer with the build that gave it (a cached copy carries the mark), each document keeps what
answered its requests, and the MPA check's fresh load sends each of the same requests to that
build (`World.answers_of`, `answer_key`: path and query, less a hole's expiry and signature).

A download a deploy failed is the deploy's, counted per document (`World.skewed`): a file asked of
a build that does not have it, or a hole refused for the other build's key
(`x-ogygia-deny: foreign-key`) when the app has no secret, as ogygia's `secret_missing` warns. In
such a document, the browser's own words for a failed download and ogygia's coded ones are
excused, nothing ogygia says without a code is, and the MPA check sets it aside as it does a
faulted one. Every other page is compared with a fresh load from the build that answered it
(`World.as_of`, past the CDN): a page of the old release is that release's, whole.

A page's unhandled rejection reaches its own window (`unhandledrejection`), as in a browser; it
went to the host process, where nothing told it from the simulator's own.

## Outages

The `outage` action is a whole flow: the visitor follows a link, presses a button, or does
nothing (a stream or a hole's fetch already on its way); some ms in (0 to 500) the connection
drops, for 1 s to 2 min, then comes back. Going offline fails what the tab has on the wire, as a
lost connection does: a request not yet answered fails to fetch, a body still coming (a page, a
live stream) breaks off (`Exchange.lost`). The document hears it as in a browser: its
`navigator.onLine` reads the tab's network, and `offline`, then `online`, fire on its window as
tasks of its realm (`Network.tell`; a page that waits for the network to come back never heard it
before, gen 88).

THE OUTAGE OVER, THE PAGE RECOVERS: a document only an outage touched (no other fault) is
MPA-checked at rest like any other (`outage-recovery`): an answer it gave up on while offline is
owed once the network is back (#891). Set aside: a document whose own load failed (the browser's
error page, an empty document), one a script or stylesheet of which failed to load (a browser
never loads one again; ogygia says `runtime_load_failed`), and one ogygia says needs a reload
(`chunk_reload_needed`: a module's dependency failed, and the browser keeps it failed, #262).

Rest waits for requests a server is still working on (a hole that renders in 3 s): its answer is
not a loop task until it comes.

## Federation

A world may hold peer apps (`WorldOptions.peers`), each at its own origin with one build and one
server instance, behind no CDN. The app's servers reach a peer over the simulated network (a
signed hop is an exchange from `server-0` like any other, so faults hit it too), and a tab loads a
peer's islands from the peer's origin, its content-hashed files answering any origin
(`access-control-allow-origin: *`, as a peer's CDN does). Each build carries its own environment
(`Build.env`, Kit's `$env/dynamic/private`): every app gets its own `<NAME>_SIGNING_KEY`, every
app's `<NAME>_PUBLIC_KEY` and `<NAME>_ORIGIN`, and `ORIGIN`, the keys drawn from the seed
(`keys.ts`: Ed25519 signs deterministically, so a run's signatures replay).

    pnpm sim --app ../../examples/mfe/shell --name shell \
      --peers cms=../../examples/mfe/cms,dash=../../examples/mfe/dash \
      --paths /cms,/cms/lab,/cms/posts/1,/cms/posts/2

`--paths` adds pages no route file names (a mounted peer's). Build the three first
(`pnpm turbo run build --filter=mfe-shell... --filter=mfe-cms... --filter=mfe-dash...`).

## The random app

`apps/sim-gen` is an app nobody wrote by hand: `pnpm sim:gen --seed N` (`src/gen.ts`) writes its
pages and regions from a seed. Islands on every schedule, holes (some woken once they land, some
slow on the server, some with a fallback, and some of a page's root holes keep it: `keepFallback()`,
its own stream `gen keep`), lakes and plain components, nested up to 3 deep, on 3
to 6 pages that link to each other (router on, csr=false). Each region is a component of its own
that imports its children with their import attributes; the tree is in
`src/lib/gen/plan.json`. Then `pnpm sim:builds --app ../../apps/sim-gen` and
`pnpm sim --app ../../apps/sim-gen`.

About half the seeds draw a peer (`peer_plan`, its own stream `gen peer`): another team's app,
written into `apps/sim-gen-peer`. It serves widgets (`federate({ widgets })`, each a root holding
a region tree, imported `with { region: 'raw' }`) and pages (`expose:` a server router, base
`/peer`). The app gets `src/lib/gen/federation.server.ts` (one `federate()`, the peer at
`PEER_ORIGIN`), slots on its pages (a `+page.server.ts` load returning
`peer.widget(name, props, { render: 'static' | 'deferred' })`, rendered with `<Region of>`, some
deferred ones with a placeholder), and the peer's pages mounted under `/peer`: by a server router's
`mount(peer)` in `src/lib/gen/mount.server.ts` (the app's hooks sequence it after ogygia's), or by a
Kit catchall's `mount.kit(peer)`. The peer's regions are numbered from 1000, so its `n1003` is never
the app's `n3`. Build the peer once (`OGYGIA_RULES=1 vite build` in apps/sim-gen-peer); the CLI reads
the peer from the app's `plan.json`, so `pnpm sim --app ../../apps/sim-gen` runs it with no flags
(`--peers peer=../../apps/sim-gen-peer`, `/peer/q<i>` added to the paths).

Some regions are held: a remote query returns `region(N, props)` (`src/lib/gen/h<k>.remote.ts`,
its schedule baked on the import: a wake, or `region: 'raw'`), and a host renders it with
`<Region of>`: plain server markup awaiting the query (some with a placeholder), or an island
reading the query's `.current` (some with a button: a command that bumps the server's count and
answers with the region, single flight). Some are live: a `query.live` yields the region anew on
each tick (every 0.7 s or 3 s), in an island host. Held and live regions draw from a stream of
their own (`gen held`), so a seed's tree is what it was before they existed.

Some commands publish (`gen publish`): the command also calls `postrender.invalidate(<its page>)`.
The app lists `postrender({ default: false })` (opt-in: no page is stored unless it says so) and
`postrender.handle({ store })` with one `MemoryStore` for every instance and build of a run, as a
shared cache is. Some pages opt in (`config = { postrender: true }`, stream `gen postrender`, 30%),
so the store holds pages and a publish has something to invalidate. And some islands change their
markup in the next release (stream `gen release`, 30%: an element only build v2 renders), so the two
builds differ as releases do and one build's HTML hydrated with the other's code shows (#947).
Four more streams reach machines no run touched before: `gen style` (a region with a scoped
`<style>`: an answer lifts its sheet into the head, `region-sheet`), `gen max age` (a hole whose
render the server keeps, `maxAge` 2 s or 30 s through a preset of apps/sim-gen's vite config, since
the compiler refuses it inline: `render cache`), `gen devalue` (an island given a `Date` prop: its
props cross in devalue's lane) and `gen page data` (a page with a server load whose regions read
`page.data.who`: a hole or held region looks its page up, `page facts`; some islands that read it
have a refresh button, `invalidateAll()`: the `soft refresh`). In a federated app the invalidation is announced to the peer: a thaw notice
through federation's outbox, which the peer applies and passes back on (hop + 1). The same store
makes a deploy's first federation request send the deploy thaw. And some seeds keep the peer's
page documents (`gen peer cache`: `cache: { ttl }` of 300 ms, 2 s or 30 s), served stale while one
fetch refreshes them.

Two more streams: `gen layout` (40% of seeds) puts a region tree in the layout, after the nav on every
page: a hole with a stylesheet of its own (ids from 500), some with a styled island inside. A router
navigation keeps it on screen while the next page's head does not list its sheet (#275): what the
region-sheet bookkeeping is for (mutation testing: two survivors there died once it was in). `gen hero`
(40% of pages) opens a page with `<img src="/hero.png" fetchpriority="high">`, served by the app's
`hero.png/+server.ts`: the page's critical resource, which island code and background downloads wait
for (the load scheduler's `critical-gate`).

Some islands that wake on their own are changed by a third party's script while they sleep (`gen third
party`, 30%): once the document is parsed, it prepends an element of its own, or (`gen third party
kind`) swaps the island's first `<span>` for a `<b>`, so the repair puts the server's markup back
before the island hydrates. A third kind, from a stream of its own (`gen third party text`, on islands
the first stream left alone) adds a text node only: every element lines up, so the repair walks into
each one, and the island holds a `<details>` (an element whose children are partly its own). A repair
that lined up names no ownership conflict there; the app's client plugin (`apps/sim-gen/src/sim-client.ts`,
`regionMismatched`) says any conflict named on the console, where the page-errors oracle hears it
(mutation: `align_to` saying a level that lined up failed).

Some islands that wake on their own render a `<svelte:head>` of their own (`gen head`, 30%): a
`<meta>` in an `{#if}` and a `<style data-gen-head>`. Half of those have a third party that puts an
element of its own right after the head block's open marker once the document is parsed, where
Svelte's head hydration would walk into it: the runtime takes every island's head block off that
walk before the first wake, and retires the page's copy once the island's own is in (the waste
check sees a `<style>` held twice when it does not). Mutation: hydrate-core's head markers left in
place, or the page copy kept, died on gen 262. The order those styles stand in after a return is
#1107 (`KNOWN`).

A RESHAPE PASS (`gen reshape`, 35% of apps; `@ogygia/reshape`): the app's own pass over the HTML
ogygia sends, as a handle in front of ogygia's (`src/lib/gen/reshape.server.ts`, written by
`app_reshape`), on every document and region answer. Half of the regions (`gen reshape boxes`) hold
their label in an `<x-gen-box>`, a web component whose server render (the pass, reduced to its
moves) puts a tree of its own in the host's light DOM and moves the host's children into a `<slot>`
in it; with the pass's `trim` it also trims and drops whitespace-only text, as a serializer does;
with `link`, an `<x-gen-link>` sits in a page's `<a>` and renders an `<a>` (the stand-in case; the
outer `<a>` is `data-gen-messy`, the render's own markup). ogygia marks before the pass and restores
in the browser before anything hydrates, so every oracle sees Svelte's markup where Svelte owns it.
The pass also fails as an app's does, through buggify points in the app's code: it throws, takes
3 s, or strips ogygia's marks (`gen.reshape-*`). ogygia sends a failed answer as it rendered it
(#1569), so the oracles that judge every page (no 500, no hydration mismatch, the MPA check against
a fresh load the pass may not have failed on) are what say a failing pass leaves the page whole.
Gens 24 (trims, links,
no router), 10 (links, router) and 196 run it. Mutation of `packages/reshape/src/restore.ts` runs
on gens 24 and 10.

## Tabs behind, and engines without idle callbacks

The visitor looks at the tab they act in, and their other tabs go behind it (`Browsers.focus`): a
tab behind reads `document.visibilityState` `hidden`, hears `visibilitychange` on each change, and
its animation frames wait until it is shown (`platform.ts` parks them; a document's first frame is
happy-dom's own, which writes the content, and is never parked). The `background` action opens a
tab behind the one looked at. A tab brought to the front is looked at 300 ms before the visitor acts
in it (gen 193, seed 8: a reload at once counted the old document's late requests as the next
one's). A document loaded behind and never shown owes its wakes after every action (`islands-wake`);
one shown before it went behind is set aside: a frame it asked for then waits, as a browser's does.
Mutation: the paint gate's hidden branch (schedule.ts) died on gen 262.

Some seeds' engine has no `requestIdleCallback` (stream `idle engine`, 30%: Safari's), so code that
waits for an idle moment takes its own fallback (core's `#on_idle` pause; mutation: died on gen 262).

A build's boot runtime comes from `packages/core/dist/runtime` (the prebuilt runtime a published
package ships), not from `src`: after a change to core's runtime, `pnpm build:lib` before
`pnpm sim:builds`, or the app boots the old one (its import-again had no buggify point, while the
chunks Vite built from `src` did).

## Running many

`pnpm sim --runs 200 [--from 41] [--steps 30] [--jobs N]`: seeds run in a pool of worker
processes (default: cores - 1; a worker is replaced after 25 runs). A run that has not ended after
`--hang-ms` (60 s real) is reported `hung`, with where it stood (queued tasks, requests on the
wire, the trace's tail, each tab's machine moves), and its worker is replaced; a worker that dies
is a `crash` finding. Virtual time is bounded by the run's horizon ((actions + 2) minutes);
reaching it is reported `horizon`. The summary goes to `internal/sim/results.json`.

## Buggify

A rare branch the code can take on purpose in a simulated run: `buggify.fires(point)` from
`@ogygia/machine`, behind the file's own RULES constant, so a production build folds it out
(`packages/core/test/rules-stripped.node.test.ts`). Only a simulated platform answers it. Each run
turns each point on or off (30%, its own stream `buggify swarm <point>`), and an on point fires at
20% of its asks, from the realm's own stream. A firing is in the trace. `--no-buggify` turns them
all off. Points: `flights.not-kept` (an answer not kept), `flights.evicted-early` (a kept answer's keep
runs out at its next read: the entry goes, `kept -> gone`, and the caller runs the work again), `outbox.reply-lost` (the receiver applied
a send and its reply was lost: sent again), `import-again.entry-missed` (a download's timing entry
never comes, as WebKit gives a dropped one none), `federation.doc-stale` (a peer document's ttl just
ran out), `hole.fetch-lost` (a hole's answer lost on the way: it tries again, or gives up, as it
would; it reaches the hole's `retrying` steps without a drop fault), `postrender.store-down` (a
page store call fails, a shared store's blip: the page renders fresh and is not kept; the `postrender
store` machine's `ok <-> failing`), `hole.answer-later` (a hole's answer comes back as a 429: it waits
and asks again; a document fires it at most twice, `CAPPED_POINTS`, so every hole's third try
answers and a hole left on its fallback is a broken retry). The ledger names the rest
(`internal/sim/failures.json`).

## Coverage

What runs reached, for a search to steer by (`src/coverage.ts`). The targets are every step of
every machine the packages define (`paths()` is one path per step), read from their source:
`machine()({ name, initial, steps })` with a literal name, and each `flights({ name })` with
flights' entry steps. A run's steps come from each document's moves (`__ogygia_moves()`, read after
every action: the log keeps only its last lines). Each run also reports each buggify point: asked,
on, fired. The summary prints one line, and `results.json` holds per machine what was reached and
what is still missing, the machines no run touched, and steps a run took that no definition names.
It also lists the RECOVERY STEPS no run reached (`unreached_recovery`: into or out of a state a
failure leads to, a retry, an offline wait, a failure, a stall, a give-up, and a keep running out,
`kept -> gone`), and the always-on run puts the ones every batch missed in its job summary: a new
recovery step nothing reaches shows at once, and each wants a buggify point, a fault or an app shape.
A server's moves too: in a rules build core's server rules keep its last 5000 under
`Symbol.for('ogygia.server.moves')`, which the simulator reads from each instance's own registry.
Every document's log is read, by realm, a left one's too (`Tab.moves_by`): a hard navigation inside
one action replaced the document before it was looked at, and the steps it took last were lost.
A flights' targets are only the entry steps its options and its file can take: `keep: 0` keeps
nothing, and with no `get(input, { fresh })` in its file an entry is never forced (`flying -> flying`,
`kept -> flying`); a fresh ask made only under `!x.flying` (a peek showing no flight out) runs a kept
answer again but never replaces a flight (`flying -> flying` is no target: federation peer documents).

EVERY STEP ACCOUNTED FOR (`src/steps.ts`, test/steps.test.ts). The ledger `internal/sim/steps.json`
puts each step in exactly one bucket: `reached` (the standard sweep reaches it), `covered` (the fake
browser cannot, or no sweep seed does; a named real test does, and the check finds that test in its
file; its `reason` says what the sweep lacks) or `dead` (no code takes it; an issue asks for its
removal). A step in no bucket fails, and so does a ledger entry no machine has (a removed step leaves
the ledger with it). `node src/steps.ts` is the static check, run by e2e.yml's PR check job ("Every
machine step accounted for", 188/188 since 2026-11-12); `node src/sweep.ts` runs the standard sweep (the
ledger's `sweep`: palaestra and generated apps' seeds) and fails when a `reached` step was not reached,
a `dead` one was, or a step is in no bucket; `--write` sets `reached` to what it reached. A step only a
lucky seed reaches is not covered: the sweep's `plans` (saved runs in `internal/sim/sweep-plans/`, each
on its app, the same run every time) name the steps each must reach, and the sweep fails when one no
longer does. dst.yml runs
the sweep before its seeds and fails the job after them when it failed.

EVERY FAILURE SITE ACCOUNTED FOR (`src/failures.ts`, test/failures.test.ts), the same model for
what can fail. The inventory parses (oxc) every package's `src` (the ledger's `scope`) and finds
each failure site: a `catch`, a `.catch(` or a two-handler `.then`, a `fetch`, a `!res.ok`, a STALE
check, an `import()`, a storage call, a `JSON.parse`, a timer, a `new …Observer`, a retry `policy(`,
an abort, an error event, a stream call, a message, a `throw`, a machine `.move(` (refused when the
state moved on), an `{ ok: false }` result, a crypto call, a body that may be null (the file's header
lists what each matches). The scope's `build_time` packages (cli, bake, barrels, config, tooling,
tsdown-plugin-svelte) no simulator runs: their sites are `covered`, never `fired`. The compiler's
are fired by the compiler's own simulator (`sim: "compiler"`). Each has a stable id, `file > enclosing function > kind:n` (n counts that kind in that
function), so lines moving above it do not move it; `node src/failures.ts --list` prints them with
their lines. The ledger `internal/sim/failures.json` puts each in exactly one bucket: `fired` (a
buggify point, a sim fault, or an app shape (`shape`: a gen stream, as `gen messy` draws a hole whose
render throws) reaches it; the sweep fails when the point did not fire; `killed_by`
names the mutant of mutants.json that breaks its recovery and the simulator kills, the proof that a
broken recovery is noticed), `covered` (a named real test, which the check finds) or `impossible` (a
rule or type, by its file and name, which the check finds). Sites nobody has bucketed yet are the
`baseline`: allowed, but it only shrinks (an id no site has fails, and the PR check, `--base
HEAD^1`, fails a baseline id its base did not list: a new site goes in a bucket). The PR check job
runs it ("Every failure site accounted for"); 4/1820 at the start (2026-11-13): hole.fetch-lost,
postrender.store-down (twice) and outbox.reply-lost's sites. To take a site out of the baseline: add
a buggify point that reaches it (behind the file's RULES constant), run the sweep and see it fire,
then break the recovery and see a seed fail, twice on the same build (the re-run rule above); the
mutant goes in mutants.json and its id in `killed_by`. A site that fires but whose broken recovery
nobody notices wants an oracle or a test first.

THE LEDGER AUTOPILOT (`src/autopilot.ts`, test/autopilot.test.ts) moves baseline sites a real test
already checks to `covered` in bulk. It puts a probe on each baseline site's recovery path (a catch
body, a `.catch` or rejection handler, a `!res.ok`, STALE, null-body, `.aborted` or `'AbortError'`
check when it holds, a throw, an `{ ok: false }`, a timer's callback, an error event's handler), runs
a package's tests once per project to learn which tests reach it, takes the probes out, then breaks
each reached recovery (a catch emptied or made to rethrow, a handler made to rethrow, a check never
true, a throw removed, a failed result made ok, a timer's callback or an error handler made to do
nothing) and reruns only the tests
that reached it, under a time limit. A reaching test that fails twice on the same mutant (the re-run
rule) is the site's `covered` test. A site whose mutants all leave its tests green SURVIVED (a test
runs the path and checks nothing: a buggify or test gap), and one no test reaches is left for a
buggify point. The source is put back after every pass and checked byte for byte; Ctrl-C puts it
back too. `node src/autopilot.ts --package core --project node --project browser [--apply]`; its
map, results (resumable), patch and report go to `--out` (default `.scratch/autopilot/<pkg>`).

MUTATION, DAILY: dst.yml's `mutate` job (cron `43 3 * * *`) runs `src/mutate.ts` over
`internal/sim/mutants.json` on main's code, over gens 10 (the router with a reshape pass: the network
faults alone kill a navigation that never hands a lost page fetch to the browser, and a hole that
never fetches again after its retry wait, both by `stuck`), 24 (a reshape pass that trims, with links: it
kills restore.ts's children not put back and its render left in the light DOM, by `ssr-hydrate`,
and a stand-in left as `<og-as>`, by `html-kept`: no reshape mark is left at rest), 121 (a peer at
two origins: its first replica down (`down`) and no answer asked of the next dies by
`mpa-equivalence`, and a widget's, a page's or a hole's failover that keeps a 500, never asks the
replica, or asks it after an answer, by `peer-failover`), 188 (an empty island that wakes: it kills the
repair's `> 0` mutant), 191 (a hole whose render throws: an error answer swapped in for its
fallback dies by `html-kept`), 192, 193, 220 (a text-only third party on a page root: it kills
`align_to`'s last `return true` -> false) and 262 (islands with a `<svelte:head>`, one a third party
edits: it kills the head mutants), 550 (an island with a margin; and seeds 33, 36, 65 and 74 past
the range, `550+33+36+65+74`: only they open a tab behind, which kills a hidden document read as
shown) and 734 (a federated app), with `--budget-min 60` (no mutant starts after an hour; the last line says
how many it judged of the list, and when) and uploads it (`dst-mutation`). Each listed mutant names
its function (`in`, the path a failure site's id names: `Class > method`, `fn > inner`, `(module)`)
and its line's `code`, never a line number, so the list outlives main's lines moving; when that code
is on two lines of the function, `nth` (0-based) says which, and one that names none throws
(`test/mutate.test.ts` checks that every one applies). The always-on job's batch
log line and summary say both numbers: steps accounted, and the latest finished mutation run's kill
rate with its date. A mutant no run can tell from the code as it is is written up in the list with
its reason (`equivalent`): it is never run, the run says it (`EQUIV`), and it stays out of the rate.
A kill stands only when a second run of its seed, on the same build, finds the same again: a
timing-bound finding that "killed" many mutants alike is said as `noise` and kills nothing. A
mutant's build is a rebuild, so it meets the baseline's world only because two builds of the same
code are the same (above): before, one seed's finding "killed" 18 federation mutants alike, a log
label's among them (gen 208, seed 13), and each replayed, on its own build.

`--guided N` searches by coverage: a run that reaches a step or fires a point no run before it had
is kept (its seed and its actions); most next runs mutate a kept one (its first actions up to a
random cut, then a new tail from a stream of its own, half the time under a new mix of action kinds:
a swarm over what the visitor does), the rest are fresh seeds. A run's workload can be spelled out
(`Plan`: actions, then a tail stream, a mix); a failure's plan goes to `internal/sim/plans/` and
`pnpm sim --plan <file>` replays it (the search checks that it gives the same trace). The search's
own choices hang on which run ends first, so it does not replay as a whole; each run in it does.

## Shrinking

`pnpm sim --app <app> --shrink <plan file>` (a search's plan, or `{ "seed": 4, "steps": 30 }` for
a seed's own workload; `--known` takes a filed bug's finding when there is no new one): delta
debugging over the actions (`src/shrink.ts`), several candidates side by side in the pool, keeping
a candidate only while it fails with the same signature (`ci.ts` `signature`). The shrunk run is
replayed twice (equal traces, or the shrink says so), and its actions, finding and the trace's
tail are printed. It writes `plans/<name>.min.json` (`--plan <file> --step N` prints the whole
trace) and `.scratch/found/<name>.test.ts` (gitignored, with any hand probes), a regression test
that runs the plan and expects the finding gone: it fails while the bug stands, and skips when the
app on disk is not the one it was found on (a generated app's seed, from its plan.json). Filed,
rename it to say the behavior and move it to `test/found/` on the finding's `sim/found-<name>`
branch: `test/found/` holds only tests put there on purpose.

A plan picks by name: each click, press or hover records what it picked (`names`: a link's
address, a button's region and text), and its replay picks the same on a page whose elements
moved; a name its page no longer has falls back to the draw and is said (`missed`). Each request
draws its fate (delay, drop, cut, stall) from a stream of its own, named by its document, method,
address (build-specific query values out) and how many times it was asked, so one more request
never moves another's. A sweep plan that misses its step says what its run took of that machine,
and what it named that was gone.

## The real-browser tier

A plan file carries its app (a generated one's seed too: `gen`), the run's wire faults (each
request of a tab's the network dropped or cut, as the `nth` of its `method path` on that tab) and
what the run found. A search writes each run it keeps to `plans/kept/` (and each failure to
`plans/`). The player (`@ogygia/tooling/e2e/sim-replay.ts`) plays plans in a real browser, one
spec per app: on the palaestra's build,

    SIM_PLANS=<plan.json>,... E2E_NO_BUILD=1 OGYGIA_SECRET=sim-secret \
      npx playwright test e2e/sim-replay --project chromium

and on the generated app on disk (its own rules build, served by `vite preview`; a `sim:browser`
script, not `e2e`, since the app's pages are not in git):

    SIM_PLANS=<plan.json>,... pnpm --filter sim-gen sim:browser [--project chromium]

A plan of another app is skipped, and so is a generated app's plan when the app on disk is
another seed's, or has a peer (a second server, not played yet). Gen 60's 8 kept plans pass in
Chromium, Firefox and WebKit. Offline is the context's (every tab's): a navigation it fails shows
the browser's error page, as in the simulator, and the run goes on.

The page's clock is Playwright's fake one (`context.clock`), moved on in slices with real time
between for the network; each wire fault is done again to the same request (`context.route`: a drop
aborts, a cut resets the connection, as the simulator's cut fails the body's read); offline is the
context's (every tab's, where the simulator's is one tab's). At rest (nothing on the wire, 20 s real
at most, then 5 s of the clock): no page error and no coded error on a tab the network did not
fail, no machine left in a state of work under way, and ogygia's rules (the `page` fixture). What the
simulator found is attached. Not played: deploys.

In Chromium the player also measures (`perf_watch`, an init script in every document): each layout
shift no input caused (none within 500 ms of an action) that came within 100 ms of a region's content
changing after the page was parsed, and each script a `long-animation-frame` entry names that ran
over 50 ms. A document whose region-caused shifts add up to 0.1, and a long task in ogygia's code (its
runtime file, or a file that holds its coded messages), fail the run; the rest is attached. Times are
a `new PerformanceMark()`'s: the fake clock moves `performance.now` and an event's `timeStamp`, not
the entries'. A timer's callback runs inside the clock's own `runFor`, so a long timer task is not
seen (its entry point is Playwright's); a fetch's answer, an event and a module's evaluation are. The palaestra's 9 kept plans of a 60-run search
pass in Chromium.

## The differential

The fake browser's gaps were found by luck (DOMContentLoaded never fired, `load` came before the
module scripts ran, history entries came at the wrong time, a left document's downloads went on),
each after hundreds of runs. The differential looks for them on purpose (`src/differ.ts`): the same
calm runs played in the simulator and in Chromium, Firefox and WebKit, and what ogygia observably
did put side by side after every action.

    node --experimental-vm-modules src/differ.ts [--app <dir>] [--from 1] [--runs 10] [--steps 8] \
      [--browsers chromium,firefox,webkit] [--out <dir>] [--reuse]
    node src/differ.ts --compare <dir>

A calm run (`cli.ts --calm`) is one both worlds can play alike: no fault, no buggify point, one
server with a stable secret, the app's own build (the one its player serves), and no deploy, offline
or outage (`NOT_CALM`, left out on both sides). `--observe <dir>` writes each run's plan with what it
saw (`<app>-<seed>.sim.json`); the player plays that plan with `SIM_OBSERVE=<dir>` and writes
`<app>-<seed>.sim.<browser>.json`. After each action each side waits for rest and looks at every tab
(`@ogygia/tooling/e2e/sim-observe.ts`, the same code on both sides): the document (`snapshot`: the
MPA oracle's normalization, which a page can run), what each document heard from before its first
script (`ear`: readystatechange, DOMContentLoaded, load, pageshow, pagehide, popstate, hashchange,
`og:*` and `ogygia:*`, capturing on the window), its machine moves, its errors and warnings, and
the requests the tabs made to the app.

Compared (`differences`): the address, the document's first differing hunk, the lifecycle's order
(a region's own events as a count: their order is the network's), each machine's steps by name and
the states left mid-work, what was said, and the requests as a multiset. What differs by
construction is masked (`plain`): the origin, content hashes, a hole's `exp=` and `sig=` (its
server's clock). A difference every browser shows alike is the simulator's (`sim-only`, the report's
first list); one only some show is `engines` (an engine's way, or timing). dst.yml's `differ` job
runs 12 seeds a day (a new range each day) in all three and puts the report in its summary.

## The compiler

`internal/compiler-dst` simulates the compiler, not the browser. An app is drawn by fast-check
(`src/app.ts`: a route tree, each node's csr in its universal or server option file, library
components importing each other, wake marks) and held in memory: the compiler reads it through its
file seam (`CompileCtx.fs`, `memory_fs`). `src/session.ts` compiles it with no Vite (prescan, then
every module for both legs) and `snapshot()` is everything it decided: registry, island closure,
region kinds, runtime marks, route worlds, each transform's output.

Oracles: two cold compiles agree; directory listing order and transform order change nothing
(`src/order.ts`). `DST_RUNS=3000 pnpm test` for a long search. Each finding becomes an issue and a
failing test in the compiler (the first: #1358).

Dev matches a cold start (`src/dev.ts`, `test/dev-cold.test.ts`): a dev server held in memory runs
the plugin's hooks for each file event in Vite's order (`watchChange`, `handleHotUpdate`, the
transform hook) and plays Vite's part with a module cache: a page load walks the module graph from
the components and the table modules, through the plugin's `resolveId`, `load` and `transform`, and
a cached module is served again until something invalidates it (Vite re-runs no plugin for a
file's importers). After random edits (files added, changed, deleted, one at a time, in a seeded
order), what dev serves, and its registry, marks and route worlds, must equal a fresh dev server on
the final files. Dev may hold more of two grow-only facts (`GROW_ONLY`: the island graph and the
runtime marks: a superset is safe), never less. A filed bug the model works around is in `KNOWN`
(`DST_KNOWN=` turns them off): it makes the model do what the fix will make the plugin do, so a
search goes on past it.

Topology (`src/topology.ts`, `test/topology.test.ts`): Kit 2 (a session per leg) and Kit 3 (one
session, both legs) serve each leg the same modules and emit the same chunks, and one build with its
modules requested in a seeded order serves the same bytes (found #1399). The app's marks cover
islands of every wake, lakes, server islands (with a fetch timing) and `region: 'raw'`.

Sound analyses (`src/reads.ts`, `test/sound.test.ts`): a component drawn from `page.data` read
shapes (members, literals, destructuring, aliases, helpers, `$derived`, markup, the `$app/stores`
store, spreads, computed keys), rendered by Svelte on the server with `page.data` a recording
Proxy: every key it read is within what seed shaping predicted (`'all'` predicts every key). A shape
a filed bug explains (#1317: a page as a parameter default) is not drawn while it is in `KNOWN`.

Next, from the compiler study (section G.4): watch (a second build in one session: compiler 5's
F1 work, #1386), metamorphic edits (renames, comments, an unused import), more analyses under the
soundness oracle (hole reads, wire crossing), and wider apps (remotes, wire classes, router pages).

## Findings

A real bug gets a GitHub issue (labels `bug`, `dst`) and a failing test on its own branch
`sim/found-<name>` (`internal/sim/test/found/`). Until its fix lands, its shape is in `KNOWN`
(oracles.ts): a seed whose only difference a filed bug explains is counted `known`, not failed.
An empty region a filed bug explains is in `KNOWN_EMPTY` (by the region's shape), and a line a
page says because of one in `KNOWN_SAID`.

## Adding an oracle

Write a function (or class) in `internal/sim/src/oracles.ts` that returns `Broken | null`, say in
its comment what it normalizes away and why, and call it from `cli.ts` (after each action, or at
rest). Oracles now: page errors and uncaught errors (excused only by a fault on that document;
anything, when the document's own HTML was changed or cut), ogygia's rules (`__ogygia_rules`), MPA
equivalence against an unfaulted fresh load (text that moves by itself at rest is masked, and so
is what differs between two fresh loads: a stamp, a counter, a fresh id the server makes each
render), a region hydrates the HTML the server sent (`ssr-hydrate`: no `hydration_mismatch`, no
`hydration_discarded`), no page paints HTML another origin answered (`foreign-html`), cache
isolation, leaks and bounded memory (a document's listeners, intervals, observers, `<head>`
children and elements must not grow visit after visit of one URL; for listeners, the same code
must be what grows: ogygia's wake delegation and Svelte's event delegation are installed once per
document, the first time a page of that kind is visited, and the leak report names what each visit
added; for observers too, by kind and callback: import-again's timing observer and the viewport
tracker's are each made once for the document, gen 195), every wait settles (`stuck`: at rest, no machine is left in a state of work under way,
any state whose name ends in `ing`), every region shows something (`empty-region`: at rest, no
`<ogygia-region>` is left with nothing in it, but a hole with no fallback still waiting to be seen
or touched), no hole that wakes on its own (`load`, `idle`) still shows its fallback at rest
(`fallback-stands`: in a document a fault touched, only one never asked for; the MPA check cannot see
it, the fresh load runs the same code; a fallback the app keeps on purpose is marked
`data-gen-kept`; found by mutation testing: a mutant whose holes never fetched survived), its twin
for islands (`islands-wake`: at rest no island that wakes on its own is still asleep, in a document no
fault touched but an outage; one inside a region waiting for the visitor or the screen waits with
it, and so does one in a lake whose host never hydrates, a held region's baked markup), the rules
once more at rest, and the watchdog (`hung`).

Each line a page says is judged by the document that said it (`Tab.said_by`): one action can show
several documents, and an old page's failed download is not the next page's. The first document is
looked at before the visitor acts. What moves by itself in the MPA check (a ticking text, a live
region's tick in its endpoint) is masked by its content, looked at for 4 s, and lined up with the
other side's same line where it moved on one side only.

The fresh load carries every cookie of the visitor's, httpOnly ones too (Kit's `cookies.set` is
httpOnly by default; palaestra seed 20004). The second and third fresh loads go at their own speed
(`Network.calm(tab, pace)`: each leg 7 or 14 ms slower), so a stamp of the render's moment differs
between them and is masked even in a run with no delay fault.

The fresh load is calm (`Network.calm`): no fault but short delays, on its own requests and on the
hops its server makes for it (a peer's fragment). A calm leg is never a long one: two long legs on
a peer hop passed the peer's 5 s timeout, and the app rightly answered 504 (gen 23, seed 23023).
It reaches the app from a client address of its own (`client_address`, Kit's `getClientAddress`):
it once met the rate limit the run's own hole retries had used up (gen 78). It asks each hole of
the build that last answered it in the tab, a batch's too (`POST /__ogygia__`, gen 77), and a file
of the build that gave it to the tab (one the old build gave in a rolling deploy's window is the
old build's, gen 88), else of the build that has it (the live one, or any when the host keeps old
files; gens 63, 65). A page store's mark (`<meta name="ogygia-stored">`) is delivery: the MPA and
leak checks set it aside. A copy the store served is of the build that rendered it, read off its
etag when it was stored (`x-ogygia-postrender: stored`), not of the server that handed it out: after
a deploy the store may still hold the old release's page (#947, gen 90). A document's page is the
build its answer names, a CDN copy's too (gen 131). A reference load pinned to an old build that the
store answered with a newer build's copy (the deploy dropped the old one's, #949) is no reference:
the world says it went `astray` and the check sets it aside. Region sheets an answer lifted into the
head are compared in any order (each went in as its answer landed; gen 143), the page's own in theirs.

## Good HTML, no waste

`src/html.ts`: every HTML answer a server of the app gave (`World.html`, as the server sent it)
through parse5 and through the tree its source says before a parser repairs it, and every document
at rest as code built it: the content model (no block in a `<p>`, nested `<a>`/`<form>`, nothing
interactive in a `<button>`, a table's own children, no id twice, no head-only element in the body,
no empty `<title>`) and end tags that close another element (`html-sent`, `html-kept`). What the app
writes badly on purpose carries `data-gen-messy` (the random app's `gen messy` stream: odd text, big
props, throwing holes, bad `{@html}` in lakes) and is the app's. Some leaves render nothing at all
(`gen empty`: an island, hole or lake with no element and no text), each used inside
`<div data-gen-empty>`, which the region oracle leaves to the app.

`src/waste.ts` (`waste`): every document of a run (a left one too), each up to what first disturbed
it (a press, a deploy, a fault on one of its exchanges), asks no answer twice (`asked_twice_each`;
judged only at rest, a document was nearly always set aside by then). A hole's answer counts by its
own GET or a router batch's part (the front door tags a batch's exchange with its holes), when asked
again within the 60 s the frame store keeps it; a router visit's batch asking it again is #1020's. At
rest, in a document no fault, deploy or press touched: no answer asked
for twice (content-hashed files and pages left out: a browser's module map keeps a file, and the
simulator has no HTTP cache; a remote query is counted per router visit, `og:before-swap` to the
next: a back is a new visit, and its held region asks again as its page does, gen 187), no POST the app refused (a batch to a path that answers none, #987),
nothing held twice (a stylesheet, a style, a module preload, a page seed, an island's props within
one answer: a region fetched apart carries its own, gen 173) and no warning said (but one a filed bug
says, `KNOWN_SAID`: Svelte's `derived_inert` on palaestra's /data is upstream, #1079, and a plain Kit
app says it too). `KNOWN_WASTE` there is KNOWN's twin. Long tasks and layout shift need a layout engine: the real-browser tier measures
them (below).

A server's hop the network tampered with puts bytes no server wrote into the page it made: html-sent
sets that document's answers aside (gen 178). An answer buggify lost on the way
(`hole.fetch-lost`) faults its document as a dropped request does (`World.fired_in`; palaestra seed
85: a hole gave up after three lost answers, as it should).

## Always on

`.github/workflows/dst.yml` (schedule every 6 h and dispatch only, never a PR) runs
`internal/sim/src/ci.ts`: batches of seeds until 20 minutes before its 350-minute timeout, yielding
to CI while more than 50 runs are queued. Findings are grouped by signature (`signature()`: the
oracle and what it is about, run-specific numbers and hashes out). An open `dst` issue that names
the signature (`dst-signature: <sig>`, in its body or a comment) gets a count comment at most once
a day (a stack frame's file and position are left out of a signature: a rebuilt app, a mutant's,
moves them all); a new one gets an issue and a `sim/found-<sig>` branch with a seeded test. The results file
(`dst-results.json`, an artifact) holds seeds run, rate and findings, for the tests page.

## Status

Stages 1 (ports) and 2 (the world) work and replay exactly; see the latest handoff note for what
is next.
