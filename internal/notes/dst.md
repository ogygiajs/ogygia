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
     midway, tamper with bytes, redirect a region's request to another origin, offline.
   - `server.ts`: a built Kit app (`.svelte-kit/output`) served in process, static files plus
     `Server.respond`. Each instance loads its own copy of the output (its own module graph), placed
     beside the app's output so it resolves the app's dependencies.
   - `browser.ts`: happy-dom browsers, one per visitor (own cookies), with tabs, back, forward,
     reload. Each document is its own realm (`tab-2#3`), so its timers die with it.
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
- It ran an inline module script at once and an external one when its file came: a document's
  module scripts run in its order (`modules_in_order`, `test/modules.test.ts`).
- Its console's methods read private fields, so a document's own console (which tells one
  document's words from another's) runs each on the page's console (`test/console.test.ts`).

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
request; the host's own real timers are counted, not waited on). A settle that gives up after
10,000 turns is counted (`loop.stalls`). Everything else a page waits on is a loop task, so the
world is AT REST when nothing is on the network and nothing is due within 2 s (`World.quiesce`).
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
island's code came is replayed once it wakes). A press makes every tab's document the visitor's
own state, so the MPA check skips each such document (its next one is clean), and the element
count leaves it out of the leak check.

## Deploys

`pnpm sim:builds` builds the app twice (`src/builds.ts`, both rules builds) into
`.svelte-kit/sim-builds/{v1,v2}`; palaestra's Counter renders `VITE_SIM_BUILD`, so the two differ
in code and HTML as two releases do. With both there, a run starts on v1 and the workload may
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
live stream) breaks off (`Exchange.lost`).

THE OUTAGE OVER, THE PAGE RECOVERS: a document only an outage touched (no other fault) is
MPA-checked at rest like any other (`outage-recovery`): an answer it gave up on while offline is
owed once the network is back (#891). Set aside: a document whose own load failed (the browser's
error page, an empty document), one a script or stylesheet of which failed to load (a browser
never loads one again; ogygia says `runtime_load_failed`), and one ogygia says needs a reload
(`chunk_reload_needed`: a module's dependency failed, and the browser keeps it failed, #262).

Rest waits for requests a server is still working on (a hole that renders in 3 s): its answer is
not a loop task until it comes.

## The random app

`apps/sim-gen` is an app nobody wrote by hand: `pnpm sim:gen --seed N` (`src/gen.ts`) writes its
pages and regions from a seed. Islands on every schedule, holes (some woken once they land, some
slow on the server, some with a fallback), lakes and plain components, nested up to 3 deep, on 3
to 6 pages that link to each other (router on, csr=false). Each region is a component of its own
that imports its children with their import attributes; the tree is in
`src/lib/gen/plan.json`. Then `pnpm sim:builds --app ../../apps/sim-gen` and
`pnpm sim --app ../../apps/sim-gen`. Federation is not generated yet (it needs two apps).

## Running many

`pnpm sim --runs 200 [--from 41] [--steps 30] [--jobs N]`: seeds run in a pool of worker
processes (default: cores - 1; a worker is replaced after 25 runs). A run that has not ended after
`--hang-ms` (60 s real) is reported `hung`, with where it stood (queued tasks, requests on the
wire, the trace's tail, each tab's machine moves), and its worker is replaced; a worker that dies
is a `crash` finding. Virtual time is bounded by the run's horizon ((actions + 2) minutes);
reaching it is reported `horizon`. The summary goes to `internal/sim/results.json`.

## Findings

A real bug gets a GitHub issue (labels `bug`, `dst`) and a failing test on its own branch
`sim/found-<name>` (`internal/sim/test/found/`). Until its fix lands, its shape is in `KNOWN`
(oracles.ts): a seed whose only difference a filed bug explains is counted `known`, not failed.

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
added), every wait settles (`stuck`: at
rest, no machine is left in a state of work under way, any state whose name ends in `ing`), the
rules once more at rest, and the watchdog (`hung`).

## Always on

`.github/workflows/dst.yml` (schedule every 6 h and dispatch only, never a PR) runs
`internal/sim/src/ci.ts`: batches of seeds until 20 minutes before its 350-minute timeout, yielding
to CI while more than 50 runs are queued. Findings are grouped by signature (`signature()`: the
oracle and what it is about, run-specific numbers and hashes out). An open `dst` issue that names
the signature (`dst-signature: <sig>`, in its body or a comment) gets a count comment at most once
a day; a new one gets an issue and a `sim/found-<sig>` branch with a seeded test. The results file
(`dst-results.json`, an artifact) holds seeds run, rate and findings, for the tests page.

## Status

Stages 1 (ports) and 2 (the world) work and replay exactly; see the latest handoff note for what
is next.
