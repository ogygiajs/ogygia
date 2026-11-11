# Fewer server chunks for cold start

Status: **research**. Nothing here is decided and nothing public exists. Anything an app would type
is marked **NEEDS OWNER YES**. The lab is `internal/server-chunks-lab/` (not a package; nothing
ships).

The question: a SvelteKit + ogygia server build puts every module in its own small file. On a slow
serverless box, does merging the server build into far fewer files cut cold-start time?

## 0. The short version

**Yes, with the right shape.** On a 0.7 CPU box with cold, throttled file reads, a cold start
that lands on a CMS page drops from **3.0 s to 1.6 s** (−46%). On a cold full-speed disk it drops
from **1.23 s to 0.23 s** (−81%). Warm requests do not change, and memory goes down.

- The biggest part of the win is bundling the dependencies (`noExternal`). About 320 small
  `node_modules` ES modules cost more than the app's own 650 chunks.
- "As few files as possible" (`single`, `bundled`) is the wrong shape. It loads every block at
  startup, so a cold start on a page without blocks gets 1.8× to 2.6× slower.
- The shape that wins everywhere is **`split`**: one file for the framework and its dependencies,
  one file per block registry, and routes as they are. Light pages start exactly as today; CMS
  pages start 46 to 81% faster.

| variant (slow disk) | files | ready + first CMS request | ready + first light request | warm p50 |
| ------------------- | ----- | ------------------------- | --------------------------- | -------- |
| default (today)     | 904   | 3004 ms                   | 805 ms                      | 2.9 ms   |
| single              | 244   | 2204 ms                   | 2102 ms                     | 2.5 ms   |
| bundled             | 244   | 1623 ms                   | 1476 ms                     | 2.4 ms   |
| **split**           | 245   | **1626 ms**               | **811 ms**                  | 2.5 ms   |

## 1. The problem, from a real app

A CMS app (described without names) has a registry file that statically imports about 225 block
components, each `with { wake: 'visible' }`. The registry's server module graph is 879 files and
16.5 MB, out of 3,405 server chunks.

- On a fast desktop core, a fresh Node 22 process takes about 345 ms and +150 MB RSS to import the
  registry.
- The CPU profile is mostly Node's ESM loader, once per file: `esm/utils` 126 ms,
  `getPackageScopeConfig` 25 ms, and about 60 ms in fs, path and URL. Component code is a small
  part. The largest chunk evaluates in 6 ms.
- On the host, a Lambda with about 0.7 vCPU and slow file reads, the first request on a fresh
  process costs about +2.1 s.
- `NODE_COMPILE_CACHE` made it slower there: reading the cache file costs more than it saves. It is
  not considered here.

Why so many files? ogygia gives each region two server modules: the island's wrapper and the
component, which is also a dynamic-import target for the hole endpoint. Rolldown's automatic
chunking then gives every module a set of importers of its own, and so a chunk of its own: one per
block, UI part, icon and util.

## 2. The fixture (`internal/server-chunks-lab/`)

`generate.ts` writes the same shape, deterministically:

- 225 blocks. Each imports 2 to 4 UI parts, 2 to 5 icons and 1 or 2 utils. One in ten does
  module-level work (builds a 2,000-row table).
- 120 shared UI parts and 300 icon components (one file per icon, like an icon library).
- 40 utils. Some use `date-fns`, `marked`, `zod` or `@floating-ui/dom`. Some do module-level work
  (a 4,000-entry map, an `Intl` formatter).
- `registry.ts` imports every block `with { wake: 'visible' }`.
- Routes: `/p/[n]` renders 5 to 9 blocks picked from the registry (a CMS page). `/` and `/about`
  use no blocks.

Built with `adapter-node`, the default server build has 904 server files (2.55 MB). Importing the
CMS page's module loads **978 files**, about 650 of the app's own chunks plus about 320 files from
`node_modules` (externals: `date-fns` alone is hundreds of small ES modules). That is the same
shape as the real app: one file per module, and a loader cost per file.

## 3. The variants

Every variant is the same app. Only the **SSR environment's** output options change. The client
build is byte-identical across variants, and every variant answers `/`, `/about`, `/p/1`, `/p/3`,
`/p/7` and `/p/42` byte-identically to `default` (`node bench.ts verify`).

| variant       | what changes (SSR build only)                                                                                 | server files | server MB | largest file | files loaded for the CMS page |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ------------ | --------- | ------------ | ----------------------------- |
| `default`     | nothing: Rolldown's automatic chunking                                                                        | 904          | 2.55      | 0.62 MB      | 978                           |
| `registry`    | `codeSplitting.groups: [{ name: 'registry', test: <registry graph> }]`                                        | 246          | 2.14      | 1.63 MB      | 322                           |
| `vendor`      | one group for bundled `node_modules` code                                                                     | 891          | 2.53      | 0.62 MB      | 968                           |
| `grouped`     | registry + vendor + the rest of the app: a handful of chunks                                                  | 247          | 2.14      | 1.63 MB      | 323                           |
| `single`      | one group that takes every module                                                                             | 244          | 2.13      | 2.01 MB      | 321                           |
| `bundled`     | `single`, plus `resolve.noExternal: true`: `node_modules` bundled in too                                      | 244          | 2.38      | 2.27 MB      | **2**                         |
| `split`       | `bundled`, in two groups: framework + deps (`node_modules`, ogygia's packages) first, then the registry graph | 245          | 2.38      | 1.61 MB      | **3**                         |
| `single-lazy` | `single` + `strictExecutionOrder` (bodies run when first needed)                                              | **hangs**    |           |              |                               |

Why 244 files remain even in `single`: about 225 of them are tiny facades
(`export { J as default } from './server.js'`). They are the per-island dynamic-import targets the
hole endpoint loads on demand. They are entries, so Rolldown keeps them as files, but a page render
never loads them (see "files loaded").

`single-lazy` never finishes importing. Kit's server graph has import cycles and top-level `await`.
`strictExecutionOrder` wraps each module body in an async init function, and two of those init
functions end up waiting on each other. Kit's post-build analysis imports the server output, so
`vite build` hangs at 0% CPU. It is worth an upstream report with a small repro before anyone tries
lazy module bodies this way.

### 3.1 How it is wired: an SSR-only hook

Kit 2 on Vite 8 builds both environments in one `vite build`. The `config` hook's `isSsrBuild` is
false there, so setting options in `config` does nothing (tried first: every variant came out with
904 files). The hook that works is `configEnvironment`:

```ts
// internal/server-chunks-lab/vite.config.ts (the lab's stand-in for an ogygia build hook)
function server_chunks(): Plugin {
	return {
		name: 'lab:server-chunks',
		configEnvironment(name) {
			if (name !== 'ssr') return; // the client build is left exactly as it is
			return {
				build: { rollupOptions: { output: { codeSplitting: { groups: [{ name: 'server' }] } } } },
				resolve: { noExternal: true } // 'bundled' only
			};
		}
	};
}
```

In ogygia this lives in core's Vite plugin (`packages/core/src/vite/index.ts`), or as a build-hook
capability for plugins (`definePlugin`'s `build(b)`, which today cannot set environment options).
Both are internal. The option an app would set is the public part.

`adapter-node` re-bundles `.svelte-kit/output/server` in a bundling pass of its own. It keeps the
chunking it is given (904 → 904, 244 → 244), so the variant survives the adapter. Other adapters
copy or trace the output. Check them before relying on this.

## 4. How it was measured

- **The slow box.** Docker on the same Mac: `--cpus=0.7 --memory=1g`, Node 22.23.4 (`node:22`). One
  fresh container per measurement.
- **Cold file reads.** Before each run the container drops the VM's page cache
  (`echo 3 > /proc/sys/vm/drop_caches`, privileged), then runs `node -e 0` so Node's own binary is
  warm (a host's runtime is warm; the function's files are not). Then one fresh process runs
  `probe.ts`.
- **Two disk modes:**
  - `cold`: cache dropped, disk at full speed. The VM disk is a fast SSD, so this is a lower bound
    on read cost.
  - `slow`: cache dropped, and the container's disk throttled to 400 read IOPS and 20 MB/s
    (`--device-read-iops`, `--device-read-bps`, cgroup v2). Measured on 800 cold small files: 19 ms
    unthrottled, 1,166 ms throttled. That is about 1.5 ms per file, the same order as the real
    host's +2.1 s for about 900 files.
- **How faithful.** The CPU limit is a cgroup quota, like Lambda's share of a core. The throttle
  models per-file read latency. It does not model Lambda's lazy-loaded image or zip blocks, its
  first-read network fetches, or its CPU (a Mac core is faster than a Lambda core even at 0.7). The
  absolute numbers are this box's. The **differences between variants** are what carry over.
- **What each run records** (`probe.ts`; times are ms since the process started):
  - `registry`: a fresh process imports only the CMS page's module, which imports the registry.
  - `cms`: start the server (`build/index.js`: import, Kit `init`, listen) = **ready**; first
    request to `/p/3` = **first**; then 300 warm requests over 50 pages = **warm p50 / p95**; RSS
    at each point.
  - `light`: the same start, with the first request to `/about` (no blocks). This is what a page
    that never uses the registry pays.
  - `count` (once per variant, warm cache): the number of files the ESM loader loads, through a
    `module.registerHooks` load hook.
- **Rounds.** 10 per variant, mode and disk, interleaved (round, then disk, then variant, then
  mode) so drift spreads evenly. The tables show medians, with p90 where it matters.

## 5. Numbers

Medians of 10 fresh containers per cell, in ms (p90 in brackets where it matters). **ready** is
process start to listening. **first** is the first CMS request after that. **ready + first** is
what a cold start that lands on a CMS page costs. **light** is ready plus the first request to a
page with no blocks.

**`slow` disk** (cache dropped, 400 IOPS, 20 MB/s, 0.7 CPU): the closest to the real host.

| variant   | registry import | ready | first CMS req | **ready + first** | light (ready + first) | warm p50 / p95 | RSS ready / after first / warm MB |
| --------- | --------------- | ----- | ------------- | ----------------- | --------------------- | -------------- | --------------------------------- |
| default   | 2301 (2890)     | 777   | 2170 (2706)   | **3004**          | 805                   | 2.9 / 54       | 92 / 135 / 153                    |
| registry  | 1810            | 2017  | 201           | 2231              | 2090                  | 2.6 / 50       | 112 / 116 / 145                   |
| vendor    | 2279            | 768   | 2214          | 2975              | 817                   | 2.6 / 52       | 92 / 137 / 150                    |
| grouped   | 1806            | 1945  | 209           | 2172              | 2036                  | 2.4 / 49       | 112 / 116 / 145                   |
| single    | 1860            | 2013  | 178           | 2204              | 2102                  | 2.5 / 47       | 114 / 119 / 146                   |
| bundled   | 1060            | 1426  | 195           | **1623**          | 1476                  | 2.4 / 50       | 110 / 114 / 146                   |
| **split** | 1122            | 784   | 846 (1543)    | **1626**          | **811**               | 2.5 / 53       | 97 / 111 / 143                    |

**`cold` disk** (cache dropped, full-speed SSD, 0.7 CPU):

| variant   | registry import | ready | first CMS req | **ready + first** | light (ready + first) | warm p50 / p95 | RSS ready / after first / warm MB |
| --------- | --------------- | ----- | ------------- | ----------------- | --------------------- | -------------- | --------------------------------- |
| default   | 944 (1106)      | 120   | 1112 (1219)   | **1234**          | 184                   | 2.6 / 52       | 92 / 133 / 153                    |
| registry  | 700             | 854   | 98            | 949               | 921                   | 2.5 / 49       | 112 / 116 / 146                   |
| vendor    | 956             | 104   | 1162          | 1265              | 168                   | 2.6 / 51       | 92 / 132 / 152                    |
| grouped   | 696             | 809   | 104           | 906               | 883                   | 2.4 / 50       | 112 / 117 / 145                   |
| single    | 710             | 823   | 104           | 969               | 894                   | 2.5 / 51       | 114 / 118 / 149                   |
| bundled   | 72              | 175   | 82            | **229**           | 193                   | 2.5 / 49       | 109 / 115 / 148                   |
| **split** | 40              | 124   | 105           | **234**           | **145**               | 2.5 / 52       | 97 / 111 / 144                    |

`split` was added after the first matrix, so its 10 rounds ran on their own afterwards, not
interleaved with the others. Its `default`-like numbers (ready, light) match `default`'s, which
suggests no drift between the two sessions. Every raw row is in `results-raw/*.jsonl` (gitignored;
the medians are in `results.json`). There were 0 errors in 420 runs.

**Files loaded** for the CMS page's module (`count`, warm cache, full CPU): default 978 (548 ms),
registry 322, vendor 968, grouped 323, single 321 (417 ms), bundled 2 (42 ms), split 3 (37 ms).

### 5.1 What the numbers say

1. **The per-file cost is real, and it is mostly `node_modules`.** Merging only the app's own
   chunks (`single`: 978 → 321 files) cuts a cold CMS start by 22 to 27%. Bundling the
   dependencies in as well (`bundled` / `split`: 2 or 3 files) cuts it by **46% on the slow disk
   (3.0 s → 1.6 s)** and **81% on the cold SSD (1.23 s → 0.23 s)**. The roughly 320 small ES
   modules that `date-fns` and friends load from `node_modules` cost more than the app's 650 own
   chunks, because Node does a package-scope lookup for each one (`getPackageScopeConfig` in the
   real app's profile).
2. **Merging everything moves the cost to startup.** `registry`, `grouped`, `single` and `bundled`
   load the whole registry graph before the server listens. A Rolldown group also takes its
   modules' dependencies, so the registry group swallows Svelte's server runtime, and every route
   imports it. A cold start that lands on a light page then pays for all 225 blocks: on the slow
   disk, light goes from 805 ms to 2.1 s (`single`) or 1.5 s (`bundled`).
3. **`split` keeps the win and drops that cost.** Framework and dependencies go in one chunk with
   the higher priority, and the registry graph in another. Only the CMS page imports the registry
   chunk. Light pages start exactly like `default` (811 against 805 ms slow, 145 against 184 ms
   cold), and CMS pages start like `bundled` (1.63 s against 3.0 s slow).
4. **`vendor` alone does nothing here.** Bundled `node_modules` code is already small in `default`,
   because most dependencies are externals that Kit leaves to Node. The win needs
   `noExternal: true`, not a vendor group.
5. **Warm requests do not change.** p50 is 2.4 to 2.9 ms and p95 is 47 to 54 ms in every variant
   (the p95 is GC, the same everywhere).
6. **One-run spread.** The slow disk has the widest spread (`default` first request p90 2.7 s,
   `split` p90 1.5 s). Ten runs per cell is enough to rank the variants, not to quote a p99.

## 6. Trade-offs, measured

- **Module bodies a page never uses.** In `bundled`, every block's and util's top-level work runs at
  startup: the fixture's 2,000-row tables, 4,000-entry maps and `Intl` formatters. Measured as
  `bundled` against `split` on a light page: +48 ms ready on the cold SSD (175 against 124) and
  +640 ms on the slow disk (1426 against 784, which also includes reading the registry chunk).
  `split` does not pay it until a page renders a block. When it does, the CMS page pays for all
  225 blocks, not the 5 to 9 it renders, exactly as `default` does today, because the registry
  imports them all statically. Lazy per-block loading would need the registry's region bindings
  to load their component on first render. That is a compiler change, not a chunking option, and
  it is not measured here.
- **Parsing more code.** One 1.6 MB and one 0.65 MB file parse lazily (V8 pre-parses function
  bodies). Importing the registry chunk takes 40 ms cold in `split` against 944 ms for the same
  code in 978 files. Parsing is not the bottleneck at this size.
- **Memory.** `split` uses the least at every point: 97 MB at ready, 111 MB after the first
  request and 144 MB warm, against 92 / 133 / 153 MB for `default`. The merged-everything
  variants start higher (109 to 114 MB at ready) and end about even. Bundling tree-shakes the
  dependencies (only the `date-fns` functions used), so less code is resident.
- **Bundle size.** The server output shrinks from 2.55 MB to 2.13 to 2.38 MB. The deploy
  `node_modules` (155 MB here) would no longer be needed for bundled dependencies. This lab did not
  test a deploy without it.
- **What `noExternal: true` can break.** Dependencies with native addons, ones that read files
  next to their own module (`new URL('./x.wasm', import.meta.url)`, `__dirname`), WASM loaders, or
  ones that must be one instance across the process (a second copy of a database driver) cannot
  always be bundled. A real option needs an `external` escape list, and a build warning naming each
  dependency it kept external and why.
- **Source maps and stacks.** Errors point into one large file. Source maps still map them back,
  so it is fine with `--enable-source-maps`, but each map is bigger.
- **Hot paths.** Function-level code is the same. Only the module layout changes, so the warm
  numbers do not move (section 5.1, point 5).

## 7. Recommendation

**Adopt the `split` shape for the server build, first as an internal build option, then as the
default once it is checked on a real serverless host.**

The shape:

1. **One server chunk for the framework and every dependency**: Svelte's server runtime, Kit,
   ogygia and `node_modules`, bundled (`noExternal`), as the highest-priority group. Its test
   matches dependencies only, so it never reaches app code through an import.
2. **One chunk per registry graph**: the blocks of a `.ts` registry with region imports, and
   everything they import that is not in group 1. The compiler already knows these modules (every
   `with { wake }` import in a `.ts` module is a held binding it minted), so the group's `test` comes
   from the compiler's own island list, not from a path pattern.
3. **Everything else stays on automatic chunking**: routes, layouts, endpoints. Those are few files.

Why not `single`: it makes every cold start pay for every block, and light pages get 2.6× slower
on the slow disk. Why not `bundled`: the same cost, smaller (+0.7 s for light pages on the slow
disk).

Where it goes in ogygia: core's Vite plugin sets it in `configEnvironment('ssr')` (the client build
is not touched), building the groups from the island registry it already has. `adapter-node` keeps
the chunks. Other adapters need a check (`adapter-vercel` traces files and does not re-bundle;
serverless adapters that bundle with their own tool would need to keep the group boundaries).

Before it becomes the default:

- run it on a real ~0.7 vCPU function with the real CMS app's build (`OGYGIA_DEBUG_CHUNKS=1`
  style switch, internal), and compare first-request time over 20 cold starts;
- check the external escape list against the real app's dependencies;
- report the `strictExecutionOrder` hang upstream with a small repro (cycles plus top-level await).
  If fixed, it would make `single` lazy and a separate option might not be needed.

## 8. Needs the owner

- **NEEDS OWNER YES:** an app-facing option to choose the server chunk shape, for example
  `ogygia({ server: { chunks: 'split' | 'default' } })`, and an `external` escape list for
  dependencies that cannot be bundled. Name and shape are proposals.
- **NEEDS OWNER YES:** making `split` the default. It bundles `node_modules` into the server output
  (`noExternal`), which changes what a deploy needs and can break dependencies that read files
  next to themselves. Recommendation: an internal switch first, then the default in a minor
  release after the real-host check, with a build message that lists what stayed external.
- **NEEDS OWNER YES (small):** filing the Rolldown `strictExecutionOrder` hang upstream (a public
  issue on another project).
- Not public, no yes needed: the `configEnvironment('ssr')` hook in core's Vite plugin, and the
  island list feeding the registry group.

## 9. How to rerun

```bash
cd internal/server-chunks-lab
pnpm install                  # at the repo root, once; and `pnpm build:lib` for ogygia's dist
node bench.ts build           # generate the fixture, build every variant into builds/
node bench.ts verify          # pages byte-identical to default; file counts and sizes
node bench.ts image           # deploy trees (pnpm deploy --prod) and one Docker image per variant
node bench.ts count           # files the ESM loader loads, per variant
node bench.ts run 10          # 10 rounds of cold runs (about 40 min), results-raw/*.jsonl
node bench.ts report          # medians into results.json and the tables above
LAB_VARIANTS=default,bundled node bench.ts run 3   # a subset
```

Needs Docker with cgroup v2 (`--device-read-iops` on `/dev/vdb`, the Docker Desktop VM's data
disk; another host may name its disk differently: `lsblk` in a container shows it).
