# @ogygia/machine

Tiny typed state machines for [ogygia](https://ogygiajs.dev). The server, the browser runtime and the compiler all use it. It has no dependencies (beyond `esm-env`) and works in Node 22+ and every modern browser.

A machine is in one state at a time, and each state lists where it can go next. Every move goes through one place, which gives you three things a pile of flags cannot:

- **Work that cannot land late.** Each visit to a state is a scope (`m.scope`). `m.scope.task()` runs async work for that visit. Leaving the state aborts the work and turns its answer into `STALE`, even if the machine comes back to the same state later.
- **Cleanups that run exactly once.** A listener, a timer, an observer or a cleanup given to `m.scope` belongs to the visit. Leaving lets go of it.
- **Waits that never hang.** `wait()` settles with `STALE` as soon as the state it waits for can no longer be reached.

## Install

```bash
pnpm add @ogygia/machine
```

## Use

```ts
import { machine, STALE } from '@ogygia/machine';

const hole = machine<{
	idle: {};
	fetching: { attempt: number };
	answered: { html: string };
	failed: { error: unknown };
}>()({
	name: 'hole',
	initial: 'idle',
	steps: {
		idle: ['fetching'],
		fetching: ['answered', 'failed', 'idle'],
		answered: ['fetching'],
		failed: ['fetching']
	}
});

const h = hole.create();

h.go('fetching', { attempt: 1 });
const html = await h.scope.task((signal) => fetch(url, { signal }).then((r) => r.text()));
if (html === STALE) return; // it moved on meanwhile
h.move('fetching', 'answered', { html }); // only if it is still fetching

const s = h.now; // narrows on `kind`
if (s.kind === 'answered') s.html;
```

The first call (`machine<{ ... }>()`) takes each state's data. The second reads the exact steps, so a move they do not allow is a type error: `h.move('idle', 'answered')` does not compile.

|                         |                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `now`                   | The state it is in: `kind` plus that state's data. A new value on every visit (`m.now === saved`).                                                                                                                   |
| `go(to, data?)`         | Moves along a step from wherever it is. `true` when it moved.                                                                                                                                                        |
| `move(from, to, data?)` | Moves only if it is still in `from` (`false`, quietly, when something else moved it first).                                                                                                                          |
| `scope`                 | This visit's [scope](#scopes): `scope.task(work)` is `STALE` once the machine leaves, `scope.defer(cleanup)` runs as it leaves, `scope.on` / `.timeout` / `.watch` hold a listener, timer or observer for the visit. |
| `wait(kind)`            | The next time it is in `kind`, or `STALE` once `kind` cannot be reached.                                                                                                                                             |
| `stop()`                | Ends the machine: aborts its tasks, runs its cleanups, settles its waits, refuses every move after.                                                                                                                  |

A move the steps do not allow throws in dev and in tests. In production it is refused (`false`), the machine stays where it is, and the move is printed once with its code: [machine_illegal_move](https://ogygiajs.dev/e/machine_illegal_move).

## States that end on their own

A state in `after` lasts at most `ms`. Still in it when the time is up, the machine takes the step `to` (one of that state's own steps, checked as you write it), with that state's data made from the one it leaves.

```ts
const hole = machine<{ idle: {}; fetching: { attempt: number }; failed: { attempt: number } }>()({
	name: 'hole',
	initial: 'idle',
	steps: { idle: ['fetching'], fetching: ['idle', 'failed'], failed: ['fetching'] },
	after: {
		fetching: { ms: 10_000, to: 'failed', data: (s) => ({ attempt: s.attempt }) },
		failed: { ms: (s) => 500 * s.attempt, to: 'fetching', data: (s) => ({ attempt: s.attempt + 1 }) }
	}
});
```

Leaving the state first, or `stop()`, cancels the time; coming back starts it again. The timed step is a move like any other: the visit's scope closes, waits and observers hear it. Only a state with a timeout pays for a timer.

## The definition as data

`hole.graph()` gives every state, its steps, whether it is final and its timeout, as plain data (devtools draw it, docs show it). `hole.paths()` gives paths from `initial` that between them take every step: drive a machine down each in a test and every move the definition allows has run.

## Scopes

A scope is one owner for everything a piece of work holds: its listeners, timers, observers, child work and cleanups. They are let go together, exactly once, when the owner ends: a page visit, a region, a request, a state's visit.

```ts
import { scope, STALE } from '@ogygia/machine';

const page = scope();
page.on(window, 'popstate', on_pop); // the event is typed from the target (`PopStateEvent`)
page.timeout(retry, 500); // ms, 'frame' or 'idle'
page.every(poll, 1_000);
page.watch(new IntersectionObserver(on_seen)).observe(el);
page.adopt(cache); // anything with Symbol.dispose / Symbol.asyncDispose
page.defer(() => console.log('left'));
const html = await page.task((signal) => fetch(url, { signal }).then((r) => r.text()));
if (html === STALE) return; // the page was left meanwhile

page.close(); // listeners off, timers cleared, observers disconnected, the fetch aborted
```

|                               |                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `scope(parent?)`              | A new scope; with a parent, one that closes with it (`parent.child()`).                                |
| `signal`                      | Aborts when it closes.                                                                                 |
| `on(target, type, fn, opts?)` | A listener on an `EventTarget`, or on a Node-style emitter (`on` / `off`). Returns its early release.  |
| `timeout(fn, when)`           | Once, after `ms`, at the next `'frame'`, or when `'idle'`. Returns its cancel.                         |
| `every(fn, ms)`               | Every `ms`. Returns its cancel.                                                                        |
| `watch(observer)`             | Disconnects it on close.                                                                               |
| `task(work)`                  | `work(signal)`; `STALE` once the scope closed, even when the work never finishes.                      |
| `child()`                     | Closes before its parent's own cleanups (or sooner, on its own).                                       |
| `defer(cleanup)`              | Runs once on close, newest first.                                                                      |
| `adopt(disposable)`           | Disposes it on close (`Symbol.dispose` or `Symbol.asyncDispose`).                                      |
| `close()`                     | Children first, then the signal, then the rest. Safe twice. Throws what cleanups threw, after all ran. |

**A stale part makes the whole wait stale.** A wait (`task`, a mailbox's `turn.wait` / `wait` / `ask`, a flights `run`, `stage().ready`) gives `STALE` when what it waited on is `STALE`, or an array with `STALE` among its items. So hand it the whole `Promise.all`, and one check covers every slot:

```ts
const both = await page.task(() => Promise.all([load_module(), pages.get(href)]));
if (both === STALE) return; // the page was left, or the page fetch was dropped
const [mod, html] = both; // neither is STALE (the type says so too: `Fresh<T>`)
```

It looks one level deep: an object holding a `STALE` is not seen, so build objects after the check. The repo's lint rule `ogygia/stale-whole` refuses a STALE-returning call left in an array that no wait checks.

A closed scope lets go of anything given to it at once: a cleanup runs, an observer disconnects, a listener or timer is never set, a task is `STALE` without running. So code that runs after its owner ended cannot leave anything behind. A scope is `Disposable`: `using s = scope()` closes it at the end of the block, and `await using` also waits for async disposals (a plain `close()` reports one that fails: [machine_dispose_failed](https://ogygiajs.dev/e/machine_dispose_failed)). Timers never keep a server process alive: their owner does.

## Flights

Keyed async work that callers share: one flight per key at a time, its answer kept as long as you say, and never a failure.

```ts
import { flights, STALE } from '@ogygia/machine';

// one key: a lazy chunk, loaded once and kept; a failed load is tried again by the next get
const core = flights({ run: () => import('./hydrate-core.ts'), retries: 1 });
const mod = await core.get();

// keyed: pages, shared while they load, kept 8 s when cacheable, 4 MB at most
const pages = flights({
	run: (href: string, signal) => fetch(href, { signal }).then(read_page),
	keep: (page) => (page.cacheable ? 8_000 : 0),
	max: 4_000_000,
	weigh: (page) => page.html.length * 2
});
const page = await pages.get('/docs', { signal }); // joins the fetch already out for /docs
if (page === STALE) return; // dropped, or this caller left

// keyed by some fields of an object input: run reads only those, and those `ignore` names
const checkouts = flights.keyed<Spec>()({
	key: ['repo', 'ref'],
	ignore: { depth: 'how much history to fetch, not which files' },
	run: ({ repo, ref, depth }, signal) => checkout(repo, ref, depth, signal)
});
```

|                                           |                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `run(input, signal, flight)`              | The work. Starts inside the `get` that finds no flight and no kept answer; that caller's input is the one run.  |
| `flights.keyed<I>()({ key })`             | The keyed form: inputs with the same `key` fields are the same flight. Default (`flights()`): the input itself. |
| `keep`                                    | How long an answer stays, ms (or made from the answer). `0` keeps nothing. Default: until `max` lets it go.     |
| `max` / `weigh(answer)`                   | The most total weight kept (default 1000, weight 1: a count); the least recently used go first.                 |
| `retries`                                 | Tries again at once, inside one flight, before it fails.                                                        |
| `get(input, { signal, fresh, priority })` | Joins, gives the kept answer, or starts a flight. `STALE` when it was dropped or this caller left.              |
| `peek(key)`                               | What the key holds now (`flying`, or `kept` with its answer and when it landed), without starting anything.     |
| `drop(key \| (key, entry) => …)`          | Takes kept answers out and ends flights in progress: their callers get `STALE`, nothing they answer is kept.    |

- **A failure is never kept.** Every caller of a failed flight gets the failure, and the next `get` starts a new one. A failing key costs one try per wave of callers, not one per caller.
- **The last caller out stops the work.** A caller with a `signal` that aborts gets `STALE` at once; the flight's own signal aborts only when every caller has left. A caller with no signal holds it until it lands.
- **`fresh` revalidates.** It starts a new flight beside the kept answer, which stays (and `peek` shows it) until the new one lands, and stays when the new one fails or is not kept. A flight already out is ended, so an answer from before a change cannot land after it.
- **The caller who needs it most sets the pace.** A `get` may say its `priority` (higher is sooner, default 0). A flight is at the highest priority of the callers that joined it: a join with a higher one raises it, a lower one never lowers it, and a caller that leaves does not take its raise back. The run reads `flight.priority` and hears each raise through `flight.onRaise(p => …)`, so it can lift its own work where the platform lets it: a download still queued, a `fetchpriority` not sent yet. A listener that throws is reported ([machine_flight_raise_failed](https://ogygiajs.dev/e/machine_flight_raise_failed)); the join goes on.
- A flights is `Disposable`: a scope can `adopt` it, and closing the scope ends its flights.

```ts
const chunks = flights({
	run: (url: string, signal, flight) => {
		const link = preload(url, flight.priority);
		flight.onRaise((p) => (link.fetchPriority = p > 1 ? 'high' : 'auto'));
		return loaded(link, signal);
	}
});
void chunks.get(url, { priority: 0 }); // a guess
await chunks.get(url, { priority: 2 }); // the visitor needs it: the guess is raised
```

Each key's entry is a machine (`flying`, `kept`, `gone`), so `observe()` hears every flight's moves under the flights' `name`. Its kept answers live in a cache (below): `keep`, `max` and `weigh` are the cache's.

## Caches

A keyed store that is always bounded, always owned, and says when it lets a value go.

```ts
import { cache } from '@ogygia/machine';

const pages = cache<string, Page>({
	max: 4_000_000, // required, finite: a cache is always bounded
	weigh: (page) => page.html.length * 2, // default 1: `max` then counts values
	keep: 60_000, // ms a value stays (or made from the value and key)
	owner: request, // a scope: its end ends the cache
	onEvict: (href, page, why) => page.stream?.cancel() // 'age' | 'size' | 'delete' | 'end'
});
pages.set('/docs', page);
pages.get('/docs'); // a use: the least recently used go first past `max`
```

|                                         |                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `max` / `weigh(value, key)`             | The most total weight it keeps. Past it, the expired go first, then the least recently used.                  |
| `keep`                                  | How long a value stays, ms (or made from the value and key). `0` keeps nothing. Default `Infinity`.           |
| `onEvict(key, value, why)`              | Hears each value that leaves, after it left, in order: `'age'`, `'size'`, `'delete'` (or replaced), `'end'`.  |
| `owner`                                 | The scope it lives in. Its end ends the cache, and every value is heard `'end'`.                              |
| `world`                                 | Values carry the stamp they were made at (`set(key, value, { stamp })`): an older one never replaces a newer. |
| `pinned(value, key)`                    | A value in use now: it counts against `max` but never goes for size; the next least recently used goes.       |
| `get` / `peek`                          | The value: `get` is a use, `peek` is not.                                                                     |
| `set` / `delete` / `clear`              | `set` says `false` when it did not keep the value (too heavy, kept 0 ms, older, or ended).                    |
| `has` / `size` / `weight` / `entries()` | What it holds now, least recently used first.                                                                 |

- **Always bounded.** A cache with no `max` does not compile. A `max` that is not a finite number more than 0 (`Infinity` included) throws `machine_bad_option` in dev; in production the cache is refused (it keeps nothing) and the code is printed.
- **One timer.** The ages are kept by one timer of the cache's scope, set for the value due first, sweeping at most once a second (a read past a value's age finds nothing at once all the same).
- **Notices never break it.** A notice that throws is reported (`machine_evict_failed`) and the rest still run. A `set` or `delete` inside a notice is a normal call: what it lets go is heard after the notices already due.
- A cache is `Disposable`: with no `owner`, a scope can `adopt` it.

## Registries

A cache holds values made again on demand; a registry holds things that are alive: a watcher, a module, a definition. Nothing in it is ever evicted. An entry leaves when its owner ends, or when the removal `add` gave back runs.

```ts
import { registry } from '@ogygia/machine';

const watchers = registry<Watcher>();
const stop = watchers.add(watcher, visit); // gone with the visit, or at `stop()`
for (const w of watchers) w(event); // in add order
```

A keyed registry holds definitions by name, each owned by a scope: the run of the module that defined it, so a dev reload ends what that run defined. A definition deleted from the code is gone; one kept is set again by the new run.

```ts
import { registry } from '@ogygia/machine';

const shapes = registry.keyed<string, Shape>();
shapes.set('circle', circle, run); // gone when `run` ends, unless set again by another owner
shapes.get('circle');
```

|                                           |                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `registry().add(entry, owner)`            | Holds `entry` while `owner` (a scope) is open; returns its removal. Each add is one entry. |
| `registry.keyed().set(key, value, owner)` | Holds `value` under `key` while `owner` is open, replacing what the key held.              |
| `get` / `has` / `entries()` / `values()`  | The definitions, in the order they were last set.                                          |
| `size` / iteration                        | What it holds now, in add order.                                                           |

- **Owned, never evicted.** Adding or setting with an owner that already ended is refused: nothing is held, and the removal is a no-op.
- **Only its own.** An owner's end takes only what it holds: a key set again by another owner stays.
- **Walk-safe.** An entry removed while the registry is walked is not walked after.

### Definer calls

A plugin's definer (`content()`, `flag()`) owns what it defines by the run of the module that called it. In dev, ogygia's transform marks each such call: `defineRun(id)` runs at the top of the module, once per evaluation, and its calls go through the wrapper it returns. The definer reads that run with `defining()`.

```ts
import { defining, registry, scope } from '@ogygia/machine';

const shapes = registry.keyed<string, Shape>();
const here = scope(); // an unmarked call (a build): as long as `shapes`
export function shape(name: string, s: Shape) {
	shapes.set(name, s, defining() ?? here); // a marked call: the calling module's run
}
```

|                 |                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `defineRun(id)` | The module `id`'s new run: ends its last run (and what it defined), returns the wrapper its definer calls go through. |
| `defining()`    | The module run whose marked call is running now, or `null` (a build, or an unmarked call).                            |

- **A module's next run ends its last one.** A definition the new code makes again is set again; one deleted from the code is gone.
- **Inert in a build.** Nothing is marked, so definitions live as long as the process.

## Queues

Work that waits for room: at most `max` jobs hold a place at once, first come, first served.

```ts
import { queue } from '@ogygia/machine';

const renders = queue<Call>({
	max: 4,
	start: (call) => call.enter(), // its turn, in the step its place came free
	stale: (call) => call.gone() // its deadline came, it was cancelled, or the owner closed
});
renders.push(call, Date.now() + 5_000);
signal.addEventListener('abort', () => renders.cancel(call));
// once the call's work is done:
renders.release();
```

|                       |                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `max`                 | The most jobs holding a place at once.                                                       |
| `start(job)`          | Starts a job; its place is its until `release()`.                                            |
| `stale(job)`          | Hears a job that will never start: its deadline came, it was cancelled, or the owner closed. |
| `now`                 | The clock deadlines are read on. Default `performance.now()`.                                |
| `owner`               | Closing it makes every waiting job stale, and any pushed after.                              |
| `push(job, deadline)` | Queues a job, to start in turn or be stale at its deadline.                                  |
| `cancel(job)`         | A waiting job leaves at once, stale; a started one is untouched.                             |
| `release()`           | A started job's work is done: its place goes to the next job, in this step.                  |

- **A place is handed on, never free in between.** A release starts the next job in the same step, so a job pushed meanwhile queues behind it. A `start` that pushes, cancels or releases is safe inside the drain.
- **A wait never hangs.** A job still waiting at its deadline is stale and never starts; one whose deadline came is passed over at a release even before the timer runs. The deadlines share one timer, at the earliest one waiting, gone once none waits.
- **No record per job.** The queue keeps the jobs themselves, in the order pushed. A `start` that throws is reported ([machine_queue_start_failed](https://ogygiajs.dev/e/machine_queue_start_failed)) and the jobs after it still start; a `stale` that throws is reported too ([machine_queue_stale_failed](https://ogygiajs.dev/e/machine_queue_stale_failed)), and the other waiting jobs still go stale.

## Outbox

Work that must happen after the response (a notice to a peer, a batch of events to a sink) goes through one place that keeps it alive, tries it again, sends it once, and calls it done only when the other side applied it.

```ts
import { outbox, policy } from '@ogygia/machine';

const peer = policy({ attempts: 4, backoff: [200, 1000, 5000], jitter: 0.2, deadline: 30_000 });

const thaws = outbox({
	name: 'thaw notices',
	send: async (n: Notice, signal) => {
		const res = await fetch(n.url, { method: 'POST', body: n.body, signal });
		if (!res.ok) throw new Error(`answered ${res.status}`); // not applied: tried again
	},
	id: (n) => n.id, // the receiver drops a second copy
	retry: peer,
	giveUp: (n, error) => console.warn('never delivered', n.id, error),
	waitUntil: (work) => platform.waitUntil(work)
});

thaws.put(notice); // returns at once, never throws
const done = await thaws.put(evict); // true once applied, false once given up (never rejects)
```

|                       |                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `send(item, signal)`  | One try. Resolves once the receiver applied it; throws when it did not. `signal` aborts at the deadline.                 |
| `id(item)`            | Names an item: a put of an id still out joins it. The receiver uses it to drop a copy it already applied.                |
| `retry`               | A `policy`: tries in all, the waits between them, their spread, and a deadline. Default `policy.standard`.               |
| `inOrder`             | One send at a time, in put order. A failing one is tried again before the next goes.                                     |
| `giveUp(item, error)` | Hears a send that ran out of tries or time, once. Default: prints `machine_outbox_gave_up`.                              |
| `waitUntil(work)`     | The platform's way to keep a request alive past its response, handed each send. Without it, the send runs on in-process. |

- **Done means applied.** The receiver applies the work first and records its id after. A failed apply answers an error and is tried again; a second copy of an applied one is dropped.
- **A policy is data.** `policy({ attempts, backoff, jitter, deadline })` is checked where it is written and frozen. `backoff` is a list of waits (the last repeats) or one number that doubles. Name each one for what it protects, so its numbers live in one place.
- **`backoffAfter(policy, n, random?)`** is the wait before try `n + 1` once try `n` failed, for code that runs its own tries by a policy: `0` up to the timer limit, spread by `jitter` (`random` is 0 to 1, default `Math.random()`).

## Messages

Every error and warning the package prints has a code and a page at `https://ogygiajs.dev/e/<code>`. `MACHINE_ERRORS` and `MACHINE_WARNINGS` are the tables they come from, by code: each entry's text and page.

## Staged changes

A change that takes several steps is built off to the side, then switched in with one synchronous step, or thrown away whole. Live state is never half-changed.

```ts
import { stage, STALE } from '@ogygia/machine';

const next = stage(visit, {
	name: 'navigation',
	build: async ({ signal, discard }) => {
		const page = await fetch_page(url, signal);
		const sheet = inert_sheet(page); // off to the side: styles nothing yet
		discard(() => sheet.remove()); // given back unless the stage commits
		return { page, sheet };
	},
	commit: ({ page, sheet }, undo) => {
		sheet.media = 'all';
		undo(() => (sheet.media = 'not all')); // put back if a later step throws
		swap_in(page);
	}
});
if ((await next.ready) === STALE) return; // the visit was left: everything built is given back
next.commit(); // false: refused (not built yet, or the visit was left)
```

- **A stage belongs to its owner's scope.** When the owner closes before the commit, every `discard` step runs, newest first. A build that lands later has its steps run at once.
- **The commit is one synchronous step**, refused until the build is ready, once the owner closed, and after a first commit. One that throws runs its `undo` steps, then the `discard` steps, and throws.

## Worlds

Data carries a stamp of the world it was made in, and a read refuses data whose stamp is out of date. A scope stops work that outlives its owner; a world stops data that outlives its facts.

```ts
import { flights, world } from '@ogygia/machine';

const pages = world();
const made = pages.stamp();
const html = await fetch_page(href);
if (!pages.fresh(made)) return; // a change since: this page is from before it
pages.bump(); // a mutation: every stamp taken so far is out of date

// split by key: a move puts out of date only what read the keys it moved
const sources = world.keyed<string>();
const docs = flights({ run: fetch_doc, world: sources, touches: (doc) => doc.tags });
sources.bump(['post:12']); // kept docs that read post 12 go; the rest stay
```

- **A stamp only moves forward.** `bump()` puts every stamp before it out of date; on a keyed world, `bump(keys)` only those that read `keys`, and `fresh(stamp, keys)` asks about those keys alone.
- **Flights take a world.** A move is a `drop` of what it touches, and an answer whose world moved while it was out is `STALE` for every caller that joined it, never kept. With `touches`, a flight with nothing kept yet goes on through a move of other keys, and is judged by its answer when it lands.
- A keyed world remembers the moves of its newest 4096 keys; an older one folds into a floor that puts every stamp before it out of date. It errs one way: data may be made again that was still good, never kept when it was not.

## Mailboxes

A mailbox runs one owner's events one at a time, in the order they came. Each event is a turn. A handler keeps its turn until it waits with `turn.wait()` or ends, so no two handlers see each other's half-done step. In ogygia each region element has one: its connect, a frame landing, a live tick and its wake's steps are turns of it.

```ts
import { mailbox, scope, STALE } from '@ogygia/machine';

const life = scope();
const box = mailbox(life); // open while `life` is

box.post(async (turn) => {
	// its turn: nothing else of the box runs here
	const html = await turn.wait(fetch_html()); // the next event runs meanwhile
	if (html === STALE) return; // the owner closed meanwhile
	apply(html); // its turn again, behind what came meanwhile
});
const n = await box.ask(() => count()); // post, and get the handler's value (STALE when dropped)
```

|                   |                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mailbox(owner)`  | A new mailbox, open while `owner` (a scope) is.                                                                                                        |
| `post(handler)`   | Runs `handler(turn)` now when the box is idle (on the caller's stack), else after what is ahead of it.                                                 |
| `ask(handler)`    | `post`, and the handler's value: rejects with its error, `STALE` when it was dropped.                                                                  |
| `turn.wait(work)` | Ends the turn while `work` settles, then queues for a turn again: `work`'s value, or `STALE` once the owner closed. Rejections throw back in the turn. |
| `wait(work)`      | A wait from outside any turn: ends nobody's turn.                                                                                                      |
| `closed`          | The owner closed.                                                                                                                                      |

- **A post during a turn runs after it**, never inside it (a listener of an event the turn dispatched, a store write that notifies the owner).
- **A plain `await` keeps the turn.** Only `turn.wait` lets the next event in.
- **Closing drops the queue.** Queued events never run, every wait gives `STALE` at once, and later posts are dropped.
- **A queued handler that throws** is reported ([machine_mailbox_handler_failed](https://ogygiajs.dev/e/machine_mailbox_handler_failed)) and the box goes on. One that runs at once throws to its poster.

A mailbox orders events; a [lock](#locks) is held across many events by an owner with a token, and can be taken from a stuck one.

## Locks

```ts
import { lock } from '@ogygia/machine';

// a lock only its owner can free
const recorder = lock();
const token = recorder.take(); // null while held
if (token !== null) try { /* … */ } finally { recorder.free(token); }
await recorder.acquire(signal); // waits its turn
```

## Slots

`slot({ name, version, make })` is one value per process (or page), shared by every copy of a package it loads: dev serves the runtime twice, and an app can bundle a package twice.

```ts
const facts = slot({ name: 'ogygia.facts', version: 2, make: () => ({ by_request: new WeakMap() }) });
```

The value lives at `globalThis[Symbol.for(name)]`. A name starts with `ogygia.` and carries no version: `version` is the value's shape, raised when the shape changes. A copy that asks for another version of a held name is refused in dev ([machine_slot_version](https://ogygiajs.dev/e/machine_slot_version)); in production it keeps a private value, said once.

## Clocks

`clock.mono()` is milliseconds on the monotonic clock, for every duration inside one process: a TTL, a deadline, a budget. A wall-clock step (an NTP correction, a VM resume) never moves it. `clock.wall()` is `Date.now()`, for a timestamp that leaves the process. A `flights` keep and a `policy` deadline are measured on `mono`; a kept answer's `at` is a wall timestamp.

## Saying it once

```ts
import { say } from '@ogygia/machine';

const warnings = say(); // remembers at most 1024 keys ({ max } to change it)
warnings.once(url, () => console.warn(`no page at ${url}`)); // once per key
warnings.once('sink', () => console.warn('the sink is down')); // a failure…
warnings.ok('sink'); // …it works again: the next failure is said again
```

- **Edge, not level.** A thing is said when it starts, not every time it is still true. One constant key says it once ever; a key from the thing (a URL, an id) says it once per thing; `ok(key)` ends a failing streak.
- **Bounded.** The least recently said key is let go past `max`, and is said again if it comes back. A long-lived server never grows with every distinct message.

## Watching

`observe((name, from, to, machine) => …)` hears every move of every machine, flights included (`to` is `null` when one stops). Devtools and tests use it. It costs one check per move while nothing listens.

`trace()` is `observe()` written down: every move as one short line, for a test to print when it fails.

```ts
const moves = trace(); // { max: 500, only: (name) => … } to change what it keeps
// …
moves.text();
// hole#1 idle -> fetching
// visit#3 loading -> answered
// visit#3 answered -> stopped
moves.stop(); // or `using moves = trace()`
```

Each machine is numbered per name in the order it first moves, so two visits in one log stay apart. It keeps the last `max` lines and says how many it let go.
