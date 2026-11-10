# @ogygia/machine

## 0.13.0

### Minor Changes

- [#430](https://github.com/ogygiajs/ogygia/pull/430) [`34fcfc8`](https://github.com/ogygiajs/ogygia/commit/34fcfc807ebc87dbcaeac073c78e66a302ae6461) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A flights keyed by some fields of its input is made with `flights.keyed<I>()({ key, run })`; `flights()` with no options no longer makes one.

- [#329](https://github.com/ogygiajs/ogygia/pull/329) [`c781aeb`](https://github.com/ogygiajs/ogygia/commit/c781aeb6e06d6416a4c930dc02e7199fea3eaee0) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `flights({ retry })` takes a `policy()` (tries, waits between them, deadline) in place of `retries`, run by the same loop as the outbox's; a wait of 0 still tries again at once ([#313](https://github.com/ogygiajs/ogygia/issues/313)).

- [#304](https://github.com/ogygiajs/ogygia/pull/304) [`b4113bf`](https://github.com/ogygiajs/ogygia/commit/b4113bf3233d2024442e8dd30bc78c0c35ac0f38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `flights()`: keyed async work that callers share (one flight per key, kept as long as `keep` says, `max`/`weigh`, `drop`, `fresh` revalidation, work stopped when its last caller leaves, and a failure never kept), in place of `once()`, which is a flights with one key.

- [#379](https://github.com/ogygiajs/ogygia/pull/379) [`11c5f0d`](https://github.com/ogygiajs/ogygia/commit/11c5f0d0d67f5c9149ba4643d979e4bdbfd3d36a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `mailbox()` runs one owner's events one at a time, in the order they came: a handler's turn lasts until it waits or ends, and the owner closing drops the queue and ends every wait with `STALE`.

- [#429](https://github.com/ogygiajs/ogygia/pull/429) [`0d22e3e`](https://github.com/ogygiajs/ogygia/commit/0d22e3e5c942f42880bfa5d91fcb6959d3a1aae2) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `backoffAfter()`, `MACHINE_ERRORS` and `MACHINE_WARNINGS` are exported from the package index; the `./internal/messages` and `./internal/policy` subpaths are gone.

- [#323](https://github.com/ogygiajs/ogygia/pull/323) [`7a53a56`](https://github.com/ogygiajs/ogygia/commit/7a53a56105714777cc3282552f52ddffc08e5414) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `outbox()`: work after the response, kept alive (`waitUntil`), tried again by a named retry `policy()` (attempts, backoff, jitter, deadline), joined by `id` while out, sent `inOrder` when asked, done only once the receiver applied it, and said once with a code when given up ([#308](https://github.com/ogygiajs/ogygia/issues/308)).

- [#188](https://github.com/ogygiajs/ogygia/pull/188) [`9cd69de`](https://github.com/ogygiajs/ogygia/commit/9cd69de1358147259cfb79a62eac00359b03bd00) Thanks [@PuruVJ](https://github.com/PuruVJ)! - New package: typed state machines (`machine()`, `lock()`) with checked moves, async work that cannot land late, cleanups that run exactly once, states that end on their own (`after`), and the definition as data (`graph()`, `paths()`).

- [#304](https://github.com/ogygiajs/ogygia/pull/304) [`b4113bf`](https://github.com/ogygiajs/ogygia/commit/b4113bf3233d2024442e8dd30bc78c0c35ac0f38) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `scope()`: one owner for listeners, timers, observers, tasks, child scopes and cleanups, all let go together and exactly once on `close()`; each visit of a machine to a state is one (`m.scope`), in place of `task()` and `onLeave()`.

- [#324](https://github.com/ogygiajs/ogygia/pull/324) [`7b35e33`](https://github.com/ogygiajs/ogygia/commit/7b35e332fe548cf08cc9f0607496c81eda7dc519) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `stage()`: a change built off to the side and switched in with one synchronous step, owned by a scope: closing the owner first gives back what the build made, and a commit that throws puts back what it changed ([#309](https://github.com/ogygiajs/ogygia/issues/309)).

- [#327](https://github.com/ogygiajs/ogygia/pull/327) [`79aa5b3`](https://github.com/ogygiajs/ogygia/commit/79aa5b3d8070c393627255fb2b4c259788d9e545) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `world()`: a stamp that only moves forward (`stamp()`, `fresh(s)`, `bump()`), split by key with `world.keyed()` (`bump(keys)` puts out of date only what read those keys); `flights({ world, touches })` drops what a move touches and makes an answer whose world moved on its way `STALE` for every caller that joined it ([#311](https://github.com/ogygiajs/ogygia/issues/311)).

- [#379](https://github.com/ogygiajs/ogygia/pull/379) [`11c5f0d`](https://github.com/ogygiajs/ogygia/commit/11c5f0d0d67f5c9149ba4643d979e4bdbfd3d36a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A wait gives `STALE` when anything it waited on is stale: `scope.task`, a mailbox's waits and `ask`, a flights run and `stage().ready` turn `STALE` or an array with `STALE` in it (a `Promise.all` with a stale part) into `STALE`, and `Fresh<T>` types the slots after the check ([#378](https://github.com/ogygiajs/ogygia/issues/378)).

- [#328](https://github.com/ogygiajs/ogygia/pull/328) [`cc047cc`](https://github.com/ogygiajs/ogygia/commit/cc047ccbe9dffe6d2e0c8bc7375a90cf305300e4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `flights.keyed<I>()({ key, ignore, run })`: a flights over an object input is keyed by the fields `key` names, spelled one way, and `run` is typed to those fields only, so work that reads a field the key leaves out does not compile unless `ignore` gives the reason; `peek` and `drop` name keys by those fields, and a flights with no `key` is keyed by its whole input ([#312](https://github.com/ogygiajs/ogygia/issues/312)).

### Patch Changes

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - Over its `max`, a flights takes out the expired answers before any live one ([#356](https://github.com/ogygiajs/ogygia/issues/356)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A flights `run` that gets its own key before it returns joins its own flight and gets its answer, instead of `STALE` ([#354](https://github.com/ogygiajs/ogygia/issues/354)).

- [#379](https://github.com/ogygiajs/ogygia/pull/379) [`11c5f0d`](https://github.com/ogygiajs/ogygia/commit/11c5f0d0d67f5c9149ba4643d979e4bdbfd3d36a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A flights run that answers `STALE` no longer leaves its key flying: nothing is kept, and the next `get` runs again ([#377](https://github.com/ogygiajs/ogygia/issues/377)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A keyed flights no longer holds every symbol used as a key field forever: a symbol made at run time is freed once nothing else holds it, and a registered one is spelled by its name ([#357](https://github.com/ogygiajs/ogygia/issues/357)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A flights answer whose `weigh` is below 0 or not a number is not kept, so a bad weight can no longer lower the total and let `max` cap nothing ([#355](https://github.com/ogygiajs/ogygia/issues/355)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - In a production build, a step naming a state that does not exist no longer makes `wait()` and `paths()` throw: they skip it, as moves already do ([#358](https://github.com/ogygiajs/ogygia/issues/358)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An outbox item whose `id` is not a string or a finite number (`undefined`, `NaN`) is not sent and is given up, instead of joining every other such item into one send ([#350](https://github.com/ogygiajs/ogygia/issues/350)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A retry that stops because its next wait would end past the deadline fails with a `TimeoutError` (the last error in its message), and a policy's wait is always a number, also for a count of 0 or a 0 backoff after very many tries ([#359](https://github.com/ogygiajs/ogygia/issues/359)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - The wait between two tries of a send (an outbox's, a `flights({ retry })` run's) keeps a Node process alive, so a process with nothing else to do no longer exits mid-retry and loses the send ([#351](https://github.com/ogygiajs/ogygia/issues/351)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - An async disposable adopted by a scope that already closed is disposed at once and its failure is said (`machine_dispose_failed`), not left unhandled; the closed scope keeps nothing of it ([#347](https://github.com/ogygiajs/ogygia/issues/347)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A scope's `{ once: true }` listener lets go of itself when it fires, as a fired timer does, so a long-lived scope no longer piles them up ([#348](https://github.com/ogygiajs/ogygia/issues/348)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A scope whose listener release throws on `close()` still lets go of the rest and runs every cleanup, then throws it ([#346](https://github.com/ogygiajs/ogygia/issues/346)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A scope task whose work closes its own scope before it returns (moves its machine on) settles with `STALE` instead of hanging ([#349](https://github.com/ogygiajs/ogygia/issues/349)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A stage whose commit closes its own owner (switching the page in moves the navigation on) keeps what it committed instead of discarding it mid-commit ([#343](https://github.com/ogygiajs/ogygia/issues/343)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A stage's discard step given after the commit is dropped instead of run at once over the live change ([#344](https://github.com/ogygiajs/ogygia/issues/344)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A stage that committed or was discarded leaves nothing on its owner, so a long-lived owner of many stages no longer grows ([#345](https://github.com/ogygiajs/ogygia/issues/345)).

- [#360](https://github.com/ogygiajs/ogygia/pull/360) [`64431ac`](https://github.com/ogygiajs/ogygia/commit/64431aca593a1e642308ca5413803841c9846ca4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - A world holds the flights made on it weakly: a flights nobody holds any more is collected and the world forgets it, instead of each one staying until disposed ([#352](https://github.com/ogygiajs/ogygia/issues/352)).
