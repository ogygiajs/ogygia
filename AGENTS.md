# Working on ogygia

Read this before you change anything here. It is the north star: how ogygia is meant to be built,
what we will not trade away, and where the details live. It applies to people and to coding agents
alike. When a choice is not covered here, pick the one that keeps these ideas true.

Details live elsewhere:

- `CONTRIBUTING.md`: naming table, how to verify a change, formatting, lint, bench files.
- `internal/notes/DESIGN.md`: the words (page, island, lake, region) and what they mean.
- `internal/notes/INVARIANTS.md`: trust boundaries, and why some designs must stay as they are.
- `packages/machine/README.md`: every primitive, with examples.
- `.claude/skills/ogygia/SKILL.md`: how an app USES ogygia. Read it before inventing a workaround.

## 1. What ogygia is

SSR regions (islands) for SvelteKit, with no patches to Kit or Svelte. A page is server HTML. Only
the parts that need it get JavaScript, and only when they need it. The runtime is small and
framework-free at boot. ogygia runs in production in large apps, so a change that alters output
without meaning to is worse than no change.

## 2. The philosophy

### Correct over easy

When the short version and the correct version behave differently, build the correct one. Say what
the short one gets wrong. Subtle differences become field bugs nobody can trace.

### Grow the sphere, never add a substructure

A bug shows a gap in a model. Find the model it lives in, widen it so one concept answers the new
case, and fold the old special cases into it so they can be deleted. Do not add a flag, a per-caller
patch, or a second mechanism beside the first. Before building, name the model, name what it
absorbs and deletes, and pick the right axis (the kind of request, not some incidental state). A
good fix usually deletes more than it adds.

### State is explicit

Anything with a lifecycle is a state machine from `@ogygia/machine`. No boolean pairs like
`loading` plus `loaded`, no generation counters, no "if it is still the same one" checks by hand.
The primitives exist so that whole families of bugs cannot be written:

| Need                                                        | Use                                  | What it rules out                                                                      |
| ----------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| A thing that moves between named states                     | `machine()`                          | illegal moves (a type error, and a coded refusal at runtime)                           |
| Async work that must not land late                          | `m.scope.task()` / `scope().task()`  | a stale answer applied after the state moved on: it returns `STALE`                    |
| Cleanups, listeners, timers, observers                      | `scope()` (or the visit's `m.scope`) | leaks and double cleanups: each runs exactly once, when the owner ends                 |
| One in-flight job per key, shared by every caller           | `flights()`                          | duplicate fetches, failed results cached forever (a failure is never kept)             |
| Retries and backoff                                         | `policy()`                           | ad hoc retry loops with different rules in different places                            |
| Work that must be sent, in order, and survive failures      | `outbox()`                           | silently dropped or reordered sends                                                    |
| Several changes that land together or not at all            | `stage()`                            | half-applied updates                                                                   |
| Freshness ("is this answer still about the current thing?") | `world()` stamps                     | comparing stale ids by hand. A `world` is about freshness; a `scope` is about lifetime |
| Events on one owner handled one at a time                   | `mailbox()`                          | two handlers seeing each other's half-done work                                        |
| Exclusive access                                            | `lock()`                             | two owners writing at once                                                             |
| A cap on work in flight, first come first served            | `queue()`                            | hand-written semaphores; a freed place taken out of turn; a waiter that waits forever  |

Rules for using them:

- Every listener, timer, observer and fetch has an owner (a scope). Nothing is "global until the
  page unloads" unless the page is the owner.
- A wait never hangs. If what it waits for can no longer happen, it settles with `STALE`.
- `STALE` passes through waits. `turn.wait`, `scope.task` and a machine's `wait` return `STALE` when
  the awaited value is `STALE`, or an array that holds one (one level deep). Check `=== STALE` right
  after every await that can return it. `Fresh<T>` types the value once it is checked.
- Machines are functions and plain data, never classes to extend. The definition is data, so
  `graph()` and `paths()` can read it.

### Rules are code, not comments

A sentence like "this must never happen" in a comment is a wish. Write it as something that fails
out loud:

- a rule (`packages/core/src/rules.ts`, with the area's rules beside its code). Rules run in dev,
  in `OGYGIA_RULES=1` builds and at the end of every e2e test (`__ogygia_rules()`), and fold out of
  production builds;
- a type that makes the wrong thing not compile;
- a lint rule (one root `.oxlintrc.json`);
- a test.

A comment's why belongs in a test. The aim is never to delete comments; it is to move what each one
knows into something that fails when that knowledge stops being true. Take the why, write the test
(or DST seed, rule, lint rule, type) that breaks without it, name the test after the behavior, and
only then delete the comment, because it has nothing left to say. Deleting a comment without that
step throws knowledge away. If breaking the behavior turns nothing red, the test comes first.

The only comment that stays is an outside fact no test can hold (a browser quirk, a spec line), as
one line that names its test: `// @why <fact> (test: file › name)`. Bug history belongs in the
test's name. Public JSDoc stays, because it feeds the API reference and editor hovers. New code adds
no other comments (`ogygia/structured-comments`; COMMENTS-ARE-TESTS in
`internal/notes/INVARIANTS.md`).

A line that lets a check through is a waiver, and a waiver names the rule it waives:
`// oxlint-disable-next-line ogygia/<rule> -- <reason>` (`@ts-expect-error` and `svelte-ignore`
likewise). A quiet catch waives `ogygia/no-silent-failures` this way. No custom tags: the older
`// ok:`, `// wall:` and `// hash:` marks are being moved to directives. Where a type can say it,
the type is the mark and no comment is needed: a module-level table that never grows is declared
`ReadonlySet`, `ReadonlyMap` or `readonly T[]`, which TypeScript enforces from every module (this
replaces `// static:`). `@why` is the only tag, because it records a fact, not a waiver.

### No silent failures

Every failure is either handled with a reason or reported with a message code. Console output from
ogygia is a code plus a link (`https://ogygiajs.dev/e/<code>`), worded for the person who has to fix
it. A deliberate swallow carries `// ok: <reason>`.

### Every bug is proved first

A bug fix is two commits: first a test that fails on the old code (run it and note how it fails),
then the fix. The test's name says the behavior in plain words. A bug without a failing test is not
understood yet.

### Real conditions

Tests run against real browsers and real builds: Chromium, Firefox and WebKit, through Vitest
browser mode and Playwright e2e on fixture apps. Races are found with seeded simulation (DST,
`fc.scheduler()`), and each ordering it finds becomes a seeded test. A refactor that should not
change output is checked old against new, side by side, and must be byte-identical.

### Small, and paid only by those who use it

The boot is small and does not load Svelte. A feature most pages never use is not in the boot: it
loads on use (a conditional `import()`) or folds out at build time. Dev-only checks and rules fold out
of production. Size is measured on every PR against its base. Growth over 0.5% needs a
`Size baseline:` line in the PR body that says why.

### Speed is counted, not guessed

Hot paths have bench files, counted in exact steps by Heisenbench, not timed. A new function on a hot
path needs a bench or a listed exemption (the `unmeasured` gate).

## 3. The public surface belongs to the owner

- Any new public API needs a yes from the owner before it is built: an export, an option key, a hook
  name, a package.json field, a wire or file format, a message code an app would match on. Stop at
  the design point and ask, with options and a recommendation. A "go" on a feature is not a go on
  every surface it grows. The plugin API (`definePlugin`, build hooks, `ctx.*` server hooks) is
  internal and can change freely.
- Public names say region, never island.
- Naming: camelCase public, PascalCase classes and components, snake_case internals,
  SCREAMING_SNAKE module constants (CONTRIBUTING.md has the table and its exceptions).
- ogygia is a general library. No customer, employer, vendor or product names in code, comments,
  tests, fixtures, commits, PRs or issues. Use generic stand-ins: `<x-widget>`, `example.com`, "a
  CMS page", "a web component".

## 4. How work lands

- Branches: `main` is development (the default; PRs target it). `latest` is what npm has. Only the
  release workflow moves it, and the sites deploy from it. `lts-0.12` is the 0.12.x patch line.
- A PR is one coherent change. Stacked PRs are fine. Bring a parent's changes into its child by
  merging, never by rebasing. Never force push.
- Every user-visible change gets a changeset: one line per change (one per fix in a multi-fix PR),
  named by package, saying what changed for users. Never hand-edit a CHANGELOG.
- Releases are automated (`.changeset/README.md`). The version PR and the release are the owner's
  call.
- Main requires one check, `ci ok`. CI is a staged graph (`.github/workflows/e2e.yml`): plan, then
  check and size, then Chromium e2e, then Firefox and WebKit. Firefox and WebKit report but do not
  block yet. Turbo's remote cache replays unchanged work.
- Dependencies: shared versions come from pnpm catalogs (`catalog:`). Package scripts are `.ts` run
  by plain Node. No `.mjs` scripts. All package source lives in `src/`. No dependency cycles between
  packages.
- Edit source by hand, not with scripted find-and-replace, so every change is read as it is made.

## 5. Before you call something done

1. Run the narrow check locally (`pnpm --filter <pkg> check`, one spec). Let CI run the full suites.
2. A bug fix has its failing-test commit first.
3. A new rule, invariant or "must" is enforced by a rule, type, lint or test, not a comment.
4. No new public surface without a yes.
5. A changeset line, if users can see the change.
6. `pnpm format` and `pnpm lint` are clean.
7. Size and speed are within budget, or the PR says why.
