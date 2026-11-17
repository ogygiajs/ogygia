# @ogygia/machine

## 0.14.0

### Minor Changes

- [#442](https://github.com/ogygiajs/ogygia/pull/442) [`95ed95c`](https://github.com/ogygiajs/ogygia/commit/95ed95c9b5fcd3a9c32348ff7e80e782140ce6ab) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `say()` in `@ogygia/machine` says a thing once per key until it recovers, remembering at most 1024 keys; a machine's warn-once and a plugin's `warn` use it, so a long-lived server no longer keeps every distinct warning text.

- [#445](https://github.com/ogygiajs/ogygia/pull/445) [`0a1e115`](https://github.com/ogygiajs/ogygia/commit/0a1e1151775fb5a68dc0e920e063a541860a9305) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `flights()` carries a priority: `get(input, { priority })` raises a flight in progress to the highest priority of the callers that joined it (never lowers it), and the run reads `flight.priority` and hears each raise through `flight.onRaise()`.

- [#416](https://github.com/ogygiajs/ogygia/pull/416) [`34420d0`](https://github.com/ogygiajs/ogygia/commit/34420d0f0aa96eade1e00bab836bbb612b1c5bed) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `flights()` now keeps at most 1000 answers by default (the least recently used go first); pass `max` to change it. A `cache()` or `flights()` `max` must be a finite number.

- [#416](https://github.com/ogygiajs/ogygia/pull/416) [`34420d0`](https://github.com/ogygiajs/ogygia/commit/34420d0f0aa96eade1e00bab836bbb612b1c5bed) Thanks [@PuruVJ](https://github.com/PuruVJ)! - New `cache()`: a keyed store that is always bounded (`max`, `weigh`, `keep`), owned by a scope, and says why it lets each value go (`onEvict`); `flights()` keeps its answers in one.

- [#769](https://github.com/ogygiajs/ogygia/pull/769) [`0ba97e8`](https://github.com/ogygiajs/ogygia/commit/0ba97e82d2caf38110fea69b15f9d285e43cbbb1) Thanks [@PuruVJ](https://github.com/PuruVJ)! - machine: `capability()` makes signed, expiring tokens addressed to an audience: length-prefixed messages that name the capability and its version, a lifetime clamped at mint and refused past its bound at check, a random nonce with optional one-time use in bounded memory, and no token from a clock that reads NaN; the signer (HMAC, Ed25519) is the caller's, and a check may bring its own verify (keys in rotation); `skew` allows for two machines' clocks; `nonce: false` mints the same token for the same inputs (not single-use, so `replay` is refused with it)

- [#473](https://github.com/ogygiajs/ogygia/pull/473) [`382525a`](https://github.com/ogygiajs/ogygia/commit/382525a5375c5716bfde101f689fe0eea7e95def) Thanks [@PuruVJ](https://github.com/PuruVJ)! - New `clock` (`clock.mono()` for durations, `clock.wall()` for timestamps). A `flights()` keep and a retry `policy()` deadline are now measured on the monotonic clock, so a wall-clock step (an NTP correction, a VM resume) no longer shortens or stretches them.

- [#1935](https://github.com/ogygiajs/ogygia/pull/1935) [`8cf2b7d`](https://github.com/ogygiajs/ogygia/commit/8cf2b7d67f01034a76333496d307c8a522b79852) Thanks [@PuruVJ](https://github.com/PuruVJ)! - New `decisions()`: a pure decision table whose inputs each take a listed set of values, so its whole input space can be walked. `decide()` throws on a combination `refuse` names (`machine_decision_refused`), and in dev on a value outside its list (`machine_decision_outside`). The test-only entry `@ogygia/machine/testing` walks a table: `rows`, `check` (named rules, each broken one named with its first row), `table` (markdown), `dead_fields` and `count`, with a 100,000-row guard (`machine_decisions_too_many`) and seeded sampling.

- [#428](https://github.com/ogygiajs/ogygia/pull/428) [`1c7580f`](https://github.com/ogygiajs/ogygia/commit/1c7580fa8a640486254c585b1849a1b491084a1a) Thanks [@PuruVJ](https://github.com/PuruVJ)! - New `defineRun(id)` and `defining()`: a plugin's definer calls owned by the run of the module that made them, so a definition deleted from the code leaves at the module's dev reload.

- [#476](https://github.com/ogygiajs/ogygia/pull/476) [`c4f48c3`](https://github.com/ogygiajs/ogygia/commit/c4f48c3e5a689b8a146fa4a060c21192f1dea8ad) Thanks [@PuruVJ](https://github.com/PuruVJ)! - New `noop` export: the one empty function, for a callback or cleanup with nothing to do.

- [#464](https://github.com/ogygiajs/ogygia/pull/464) [`6d0a5cb`](https://github.com/ogygiajs/ogygia/commit/6d0a5cbab7acd66761c0aaab0e24d94e3ea852c6) Thanks [@PuruVJ](https://github.com/PuruVJ)! - New `queue()`: a bounded, first-come queue. At most `max` jobs hold a place; a `release()` hands its place to the next job in the same step. A job can carry a deadline (all deadlines share one timer) or be cancelled, and the queue's `owner` closing makes the waiting jobs stale.

- [#416](https://github.com/ogygiajs/ogygia/pull/416) [`34420d0`](https://github.com/ogygiajs/ogygia/commit/34420d0f0aa96eade1e00bab836bbb612b1c5bed) Thanks [@PuruVJ](https://github.com/PuruVJ)! - New `registry()` and `registry.keyed()`: owned entries and definitions that leave with their owner, never evicted; `cache()` takes `pinned(value, key)` for values in use that never go for size.

- [#478](https://github.com/ogygiajs/ogygia/pull/478) [`59fef58`](https://github.com/ogygiajs/ogygia/commit/59fef58cadfae4e27ff8e0e74e1716ab8c2b422e) Thanks [@PuruVJ](https://github.com/PuruVJ)! - New `slot({ name, version, make })`: one process-global value per name, shared by every copy of a package a process loads. The version lives only in `version` (a name carries none): another version is refused in dev and kept apart in production.

- [#672](https://github.com/ogygiajs/ogygia/pull/672) [`e3b6b5f`](https://github.com/ogygiajs/ogygia/commit/e3b6b5f0957b5b46dd8810baef988825cb6733a5) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `trace()` in `@ogygia/machine` writes every machine move as one short line (`visit#3 loading -> answered`), the last 500, for a test to print when it fails.

- [#1839](https://github.com/ogygiajs/ogygia/pull/1839) [`4d0d5bb`](https://github.com/ogygiajs/ogygia/commit/4d0d5bb3a7534ccf88ec9fe7f5595caffce3b003) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `queue()` serves lines with more rules than first come: `priority(job)` (read again each pass, ties in the order pushed), `ready(job)` (a job not ready is passed over, the rest still start), `windows: [{ max, holds }]` (caps over some jobs, beside `max`), `budget: { ms, yield, defer?, settle? }` (a long drain hands the thread back), and `recheck()`. `max` is now optional, and a budget `yield` that throws is reported (`machine_queue_yield_failed`).

- [#1234](https://github.com/ogygiajs/ogygia/pull/1234) [`b97908b`](https://github.com/ogygiajs/ogygia/commit/b97908ba1fcacd34ec2ac2b95de0ffdc27cbb5ba) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `queue()` hands each started job its own place: `start(job, place)`, given back with `place.release()`, once (a second release frees no other job's place). `queue.release()` is gone. A `start` that throws now gives its place back, so the jobs after it still get one.

- [#1842](https://github.com/ogygiajs/ogygia/pull/1842) [`b6b930e`](https://github.com/ogygiajs/ogygia/commit/b6b930e1d4620e543965b187e47a4b059fd62718) Thanks [@PuruVJ](https://github.com/PuruVJ)! - These methods are now typed as function properties, so passing one on by itself (`const { handle } = router`) type-checks under `unbound-method`; none of them used `this`. A method type was bivariant in its parameters and a function property is checked strictly, so code that assigned a narrower function to one of them may now need its parameter types widened. The changed types: `ogygiaTransport.Region.encode` / `.decode` and the ref entry's `encode` / `decode` (`@ogygia/core`), `CapabilitySigner.sign` / `.verify` (`@ogygia/core`), `Router.handle` (`@ogygia/router`), `Signer.sign` / `.verify` and `Staging.discard` (`@ogygia/machine`).

### Patch Changes

- [#1027](https://github.com/ogygiajs/ogygia/pull/1027) [`1b69b9f`](https://github.com/ogygiajs/ogygia/commit/1b69b9ff9294af4db2d2104458375affdb0885e2) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `@ogygia/machine`: Faster hot reads on `cache()` and `registry()`: a `get` of the value set or read last no longer moves or looks it up again (a kept `flights` answer read by every island takes about half the steps), a cache with no `onEvict` queues no notices, observers are walked from one array kept until they change (`registry().snapshot()`), and `registry.keyed()` walks its definitions without a generator.

- [#1029](https://github.com/ogygiajs/ogygia/pull/1029) [`40b91ab`](https://github.com/ogygiajs/ogygia/commit/40b91ab2ba808b29b6586972a214ee5869d743bb) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `@ogygia/machine`: A `cache()` set of the value its key already holds keeps it (no `'delete'` notice, so an `onEvict` cleanup no longer runs on a value still held), `set` takes its own `keep`, and a keyed `flights` of one field keys by that field's value with no string built.
  `@ogygia/core`: A region answer written to the frame store costs about a third fewer steps (one cache write, no lookup before it), and an island warm reads its chunk graph once.

- [#419](https://github.com/ogygiajs/ogygia/pull/419) [`1e7c5d4`](https://github.com/ogygiajs/ogygia/commit/1e7c5d43025453572a06e6550dfd084e401cccea) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `observe()` keeps its watchers in a registry: each leaves with its stop, and the rest hear moves in the order they started watching.

- [#902](https://github.com/ogygiajs/ogygia/pull/902) [`c9d5323`](https://github.com/ogygiajs/ogygia/commit/c9d53230ca08bdb858723330f442a66e6902e8c4) Thanks [@PuruVJ](https://github.com/PuruVJ)! - - `@ogygia/machine`: `cache()` and `registry()` are smaller in a bundle (about 240 B brotli off a page's boot), and a bundle that uses `registry()` no longer carries `defineRun()` and `defining()`.

- [#1017](https://github.com/ogygiajs/ogygia/pull/1017) [`5c16332`](https://github.com/ogygiajs/ogygia/commit/5c16332e880dd1cc35c3a6120fd5534a547af6ff) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `@ogygia/machine`: `queue()` with no `now` reads its deadlines on `clock.mono()`, like every other primitive, so a run that drives the clock drives the queue too.

- [#778](https://github.com/ogygiajs/ogygia/pull/778) [`9b9f253`](https://github.com/ogygiajs/ogygia/commit/9b9f253baf604bc8783414ed86d79e086a095878) Thanks [@PuruVJ](https://github.com/PuruVJ)! - core: region links are signed through `capability()`, naming the islands endpoint they are for and refusing a lifetime longer than the app ever mints; links stay identical between renders, and links signed before (pages cached before the upgrade) still work and are re-signed in the new form when renewed
  machine: `capability().mintUntil()` mints a token that expires at a given time, so tokens without a nonce stay identical across a window the caller picks

- [#1236](https://github.com/ogygiajs/ogygia/pull/1236) [`7c9ef65`](https://github.com/ogygiajs/ogygia/commit/7c9ef65cdb046f503ffa571d5bd6e09ed294026f) Thanks [@PuruVJ](https://github.com/PuruVJ)! - `@ogygia/machine`: in production, a `slot()` asked for at a version other than the one held keeps one private value for that version, made once. It made a new value on every ask, so state kept in it was lost.

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
