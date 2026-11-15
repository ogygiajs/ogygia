# Compiling ogygia's internals down (idea, parked)

Status: brainstorm. Not scheduled. The owner keeps it here so the thinking is not lost.

## The aim

ogygia has grown. A lot of its browser code is bookkeeping that is plain to read in source but does
not minify and gives the browser nothing: state names as strings, step tables as objects of arrays,
option objects, message codes, object keys no minifier may rename, decision tables built at run
time. The idea: since ogygia is already a Vite plugin in every app, the app's build (preferably) or
ogygia's own build compiles that bookkeeping down to small ints, bitmaps and lookup arrays, while the
source stays as readable as it is today.

What already works this way, and shows the idea is ogygia-shaped:

- `core_defines()` in `packages/compiler/src/vite/index.ts` sets `__OGYGIA_DEVTOOLS__`,
  `__OGYGIA_RULES__`, `__OGYGIA_HOOK_*`, `continuity_forms` and others per app, so whole features
  fold out of builds that do not use them.
- `packages/machine/src/messages.ts` drops its wording tables in a production browser build and
  prints the code's link alone.
- The `import.meta.og.*` macros (`og.$`, `og.wire`) are compile-time rewrites already.

This note extends that from "fold a feature out" to "compile what is left down".

## Where it runs

- **The app's build (preferred).** ogygia's Vite plugin transforms `@ogygia/*` modules (they are in
  `ssr.noExternal` and `optimizeDeps.exclude` already, so Vite sees their source). This is the only
  place that knows the whole app: which region kinds it uses, which machines and states its pages can
  reach, which decision rows can occur. That is where the biggest cuts are (see example 3).
- **ogygia's own build.** Work that is the same for every app (parsing machine definitions, building a
  table once) can be done at publish time and shipped as data, so the app-side step is a cheap
  specialise-and-prune pass. Recommended split: heavy, app-independent analysis at our build; the
  final compile that needs app facts in the app's build.
- The source keeps running uncompiled in dev and in tests, exactly as today. The compiled form is a
  production browser concern first.

## Examples (real code, before and after)

### 1. A machine's step table becomes a bitmap per state

Source today (`packages/core/src/runtime/load-scheduler.ts`):

```ts
const gate_definition = machine<{
	fresh: {};
	touched: {};
	waiting: { t0: number; resources: number };
	settled: { report: CriticalReport };
}>()({
	name: 'critical-gate',
	initial: 'fresh',
	steps: {
		fresh: ['touched', 'waiting', 'settled'],
		touched: ['settled'],
		waiting: ['settled'],
		settled: []
	}
});
```

Compiled for a production browser:

```js
// states: fresh 0, touched 1, waiting 2, settled 3
// steps[from] is a bitmap of the states it may go to
const gate_definition = $.def(0, [0b1110, 0b1000, 0b1000, 0]);
```

The name, the state strings and the arrays are gone. Dev, tests and devtools keep the readable
definition (it is still the data `graph()` and `paths()` read); the compiled table is generated from
it, so the two cannot drift.

### 2. Reads and moves become int compares

```ts
// source
if (gate.now.kind === 'waiting') settle_critical('input');
gate.go('settled', { report });
```

```js
// compiled
if (gate[0] === 2) settle_critical(1);
$.go(gate, 3, report); // legality is a bit test: steps[gate[0]] & (1 << 3)
```

Where the current state is visible at the call site (inside `if (m.is(A))`), an illegal move is a
build error at that line instead of a runtime check.

### 3. Region's decision table is pruned to what the app can reach

`packages/core/src/region-plan.ts` (phase 2, #1991) decides a region's plan from a `decisions()`
table: 12 kinds × 9 more inputs = 9,216 rows, about two thirds refused. In the app's build:

- `server: true` rows never run in the browser: drop them (half the table);
- the app's compiler already knows which region kinds the app wrote (`island`, `hole`, `lake`, …):
  drop the kinds it never uses;
- what is left becomes a packed `Uint8Array` of plan ids into a small pool of distinct plans:

```js
// an app with islands and holes only, browser build
const PLAN_OF = new Uint8Array([/* index by packed inputs */]);
const PLANS = [/* the few distinct plans, as tuples */];
const plan = PLANS[PLAN_OF[(kind << 6) | (in_island << 5) | (live_snippet << 4) | …]];
```

`refuse()` keeps its coded error in dev; in production a refused row is a single int that maps to
the message page.

### 4. The settings bag becomes positional

The compiler already writes one hoisted `__og` object per region wrapper (#1991). Its keys
(`wakeMargin`, `onExpire`, `cacheTtl`, …) are object keys, which no minifier may rename. Since the
compiler writes both the bag and every read of it:

```js
// today
const __og = { mode: 'island', wake: 'visible', wakeMargin: '200px', keep: 'cart', entry: '/x.js', … };
// compiled: flags packed, strings positional
const __og = [0b0101_0010, '/x.js', 'cart', '200px'];
```

### 5. Option objects become bitflags

```ts
wait.on(el, 'load', one, { once: true });            // source
$.on(wait, el, 'load', one, 4);                      // compiled: once = 4
```

### 6. Message codes become numbers in the browser

The wording already folds out of production browser builds. The code strings stay
(`'machine_illegal_move'`, every `region_*`, `federation_*`, …). Compiled, a browser bundle carries
ints, and the link becomes `https://ogygiajs.dev/e/<n>`, which the docs map back to the named page.
Dev and the server keep names. Note: message codes are public surface (an app may match on them);
numbers in production need the owner's yes (see below).

### 7. Internal object keys become tuple slots

Runtime records that never leave ogygia's code (a scope's cleanups/children/parent/closed, a frame
store entry, a load slot, a plan) read like objects in source and compile to arrays whose slots
minify to nothing:

```js
// source: life.defer(fn); if (life.closed) …
$.defer(life, fn); if (life[3]) …
```

Ops become free functions in one runtime module (`import * as $`), so the app's minifier shortens
them and tree-shakes the unused ones. Class methods are never tree-shaken or shortened today.

### 8. (Needs the owner) HTML attribute names

Server and browser come from the same app build, so `data-ogygia-region-css` and friends could be
shortened consistently. But they are a wire format, apps and tests may target them, and devtools
reads them: lowest priority, owner's call.

## What the build can catch, once it understands this code

Unreachable states, steps to unknown states, duplicate steps, timers outside their state, a scope
nobody owns, illegal moves where the state is known, dead or contradictory decision rows, a plug-in on
a host that does not support it. Several of these are runtime rules today; they would move earlier.

## Costs and risks

- Two forms of the same code. Tests, the DST simulator and Heisenbench must run on the compiled
  output too (the suite already runs on built output for e2e). Every rewrite gets a fixture test:
  source → dev output → prod output.
- Debugging production: dev keeps names; prod needs a names table on demand (devtools can load it),
  plus source maps that point at the readable source.
- AGENTS.md: "machines are plain data" stays true in source; the compiled form is generated from it.
  Worth saying so in the rule if this is built.
- Per-app transform time in the app's build (small if heavy work is done at our build).
- Apps that consume ogygia without its Vite plugin do not exist today (the plugin is required), so
  there is no uncompiled production path to keep.

## Owner decisions, if this is ever picked up

1. Message codes as numbers in production browser builds (public surface)? Recommendation: yes, with
   dev and server keeping names and the docs mapping numbers to pages.
2. Shorten HTML attribute names? Recommendation: not now.
3. App build vs our build split. Recommendation: analysis at our build, specialise-and-prune in the
   app's build.

## A first experiment

Compile only the runtime's machine definitions and `is`/`go` calls (example 1 and 2) plus option
bitflags (example 5) in ogygia's Vite plugin, for `@ogygia/core` and `@ogygia/machine`. Measure
palaestra's boot and region chunks (brotli) and Heisenbench steps before and after. Success: a clear
byte cut with zero test, snapshot or simulator differences.

Related: a sibling library is exploring the same idea for its own state-machine layer first
("Design B" in its internal notes); its results should inform
this before ogygia starts.
