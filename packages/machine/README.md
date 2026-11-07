# @ogygia/machine

Tiny typed state machines for [ogygia](https://ogygiajs.dev). The server, the browser runtime and the compiler all use it. It has no dependencies (beyond `esm-env`) and works in Node 22+ and every modern browser.

A machine is in one state at a time, and each state lists where it can go next. Every move goes through one place, which gives you three things a pile of flags cannot:

- **Work that cannot land late.** `task()` runs async work for the state the machine is in. Leaving that state aborts the work and turns its answer into `STALE`, even if the machine comes back to the same state later.
- **Cleanups that run exactly once.** `onLeave()` ties a cleanup (a listener, a timer, an observer) to the state. Leaving runs it.
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
const html = await h.task((signal) => fetch(url, { signal }).then((r) => r.text()));
if (html === STALE) return; // it moved on meanwhile
h.move('fetching', 'answered', { html }); // only if it is still fetching

const s = h.now; // narrows on `kind`
if (s.kind === 'answered') s.html;
```

The first call (`machine<{ ... }>()`) takes each state's data. The second reads the exact steps, so a move they do not allow is a type error: `h.move('idle', 'answered')` does not compile.

|                         |                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `now`                   | The state it is in: `kind` plus that state's data.                                                  |
| `go(to, data?)`         | Moves along a step from wherever it is. `true` when it moved.                                       |
| `move(from, to, data?)` | Moves only if it is still in `from` (`false`, quietly, when something else moved it first).         |
| `task(work)`            | Runs `work(signal)` for this visit to the state. `STALE` once the machine leaves it.                |
| `onLeave(cleanup)`      | Runs `cleanup` once, when the machine leaves this state.                                            |
| `wait(kind)`            | The next time it is in `kind`, or `STALE` once `kind` cannot be reached.                            |
| `stop()`                | Ends the machine: aborts its tasks, runs its cleanups, settles its waits, refuses every move after. |

A move the steps do not allow throws in dev and in tests. In production it is refused (`false`), the machine stays where it is, and the move is printed once with its code: [machine_illegal_move](https://ogygiajs.dev/e/machine_illegal_move).

## Two helpers

```ts
import { once, lock } from '@ogygia/machine';

// load once and keep it, but never keep a failure: the next call tries again
const core = once(() => import('./hydrate-core.ts'), { retries: 2 });
await core();

// a lock only its owner can free
const recorder = lock();
const token = recorder.take(); // null while held
if (token !== null) try { /* … */ } finally { recorder.free(token); }
await recorder.acquire(signal); // waits its turn
```

## Watching

`observe((name, from, to, machine) => …)` hears every move of every machine (`to` is `null` when one stops). Devtools and tests use it. It costs one check per move while nothing listens.
