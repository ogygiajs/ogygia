/**
 * `pnpm sim`: runs seeds against a built app and reports what broke.
 *
 *   pnpm sim                         # 20 seeds from 1, 12 actions each, palaestra
 *   pnpm sim --seed 7                # one seed (replays it exactly)
 *   pnpm sim --seed 7 --step 4       # ...stopping after action 4, its trace printed
 *   pnpm sim --runs 200 --steps 30   # more
 *   pnpm sim --from 41 --runs 200    # seeds 41 to 240
 *   pnpm sim:long                    # the nightly size
 *   --app <dir>                      # another app (its .svelte-kit/output, built with OGYGIA_RULES=1)
 *   --no-replay                      # skip the replay check (each seed run twice, traces compared)
 *   --jobs N                         # worlds at once, each in its own process (default: cores - 1)
 *
 * Seeds run in a pool of worker processes (each world has its own host, and a worker is replaced
 * after a few dozen runs: a loaded server graph is never freed). A seed's replay runs in another
 * worker than its first run where the pool has two, so state a process keeps between worlds shows
 * as a replay difference too.
 *
 * Each run: a world from the seed (faults: a random subset, the swarm), one visitor, a workload of
 * actions; after each action the page's errors and ogygia's rules; at the end, with every tab back
 * online, MPA equivalence for each tab whose last load was online, and cache isolation.
 *
 * THE REPLAY CHECK: every seed runs twice, and the two traces (every loop task, every action, each
 * tab's URL and DOM hash after it, what broke) must be equal byte for byte. A difference is a
 * nondeterminism leak in the simulator (real async work that moved relative to virtual time), and
 * no finding from that seed is trusted until it is fixed.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
// (the host's real timers: a run replaces the global ones with its simulated ones)
import { clearTimeout as clearRealTimeout, setTimeout as real_timeout } from 'node:timers';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, act, next_action, ACTION_KINDS, type Action, type Mix } from './workload.ts';
import { html_kept, html_sent } from './html.ts';
import { asked_twice_each, waste } from './waste.ts';
import {
	document_faulted,
	faulted,
	outage_only,
	hydrates_as_sent,
	Leaks,
	mpa_equivalent,
	no_cross_visitor_cache,
	no_foreign_html,
	normalize,
	page_errors,
	page_rules,
	regions_show,
	fallback_stands,
	live_events,
	server_rules,
	styled_regions,
	stuck,
	uncaught,
	type Broken
} from './oracles.ts';
import { rng, type Rng } from './rng.ts';
import { signature } from './ci.ts';
import { ddmin, regression_test, slug } from './shrink.ts';
import type { FaultClass } from './network.ts';
import type { Visitor } from './browser.ts';
import { ORIGIN, World, type Rollover, type WorldOptions } from './world.ts';
import { builds_of } from './builds.ts';
import { key_pair } from './keys.ts';
import { MOUNT, type GenPeer } from './gen.ts';
import type { Build } from './server.ts';
import { observe } from './observe.ts';
import { NOT_CALM, type Observed, type Seen } from '@ogygia/tooling/e2e/sim-observe.ts';
import {
	all_steps,
	Coverage,
	new_moves,
	step_of_move,
	universe,
	type RunCoverage
} from './coverage.ts';

const arg = (flag: string): string | undefined => {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
};
const LONG = process.argv.includes('--long');
const REPLAY = !process.argv.includes('--no-replay');
/** `--calm`: the differential's world (src/differ.ts), one a real browser can play alike: no fault,
 *  no buggify point, one server with a stable secret, one build, and none of `NOT_CALM`'s actions. */
const CALM = process.argv.includes('--calm');
/** `--observe <dir>`: each run's plan and what the visitor saw after each action
 *  (@ogygia/tooling/e2e/sim-observe.ts) go to `<dir>/<app>-<seed>.sim.json`, for the differential. */
const OBSERVE = arg('--observe');
/** Buggify points on (`--no-buggify`: off), in a rules build. */
const BUGGIFY = !process.argv.includes('--no-buggify') && !CALM;
// (`SIM_APP`: a found test's app, set before it imports this module)
const APP = resolve(
	arg('--app') ??
		process.env.SIM_APP ??
		fileURLToPath(new URL('../../../apps/palaestra', import.meta.url))
);
const OUTPUT = join(APP, '.svelte-kit', 'output');
/** The builds a run starts on and deploys between: the app's two sim builds (`pnpm sim:builds`),
 *  else its one build, which never deploys. */
const BUILDS: readonly Build[] =
	builds_of(APP).length > 0 && !process.argv.includes('--calm')
		? builds_of(APP)
		: // (a calm run's is the app's own build, the one its real-browser player serves)
			[{ id: 'v1', output: OUTPUT }];
/**
 * FEDERATION: `--name shell --peers cms=<app dir>,dash=<app dir>` runs the app with peer apps, each
 * at `https://<name>.test` (`WorldOptions.peers`). Every app gets the environment federation's
 * examples read: its own `<NAME>_SIGNING_KEY`, every app's `<NAME>_PUBLIC_KEY` and `<NAME>_ORIGIN`,
 * and `ORIGIN`; the keys drawn from the seed (`keys.ts`).
 */
const NAME = arg('--name') ?? 'app';
/** A generated app's plan (`src/lib/gen/plan.json`), or null for an app nobody generated: its seed
 *  (a plan file names it, so a run is played on the app it was found on), and a seed that drew a
 *  peer names it there, so its runs need no flags (`<app>-peer`, its pages mounted under `MOUNT`). */
const GEN = ((): { seed: number; peer: GenPeer | null } | null => {
	const at = join(APP, 'src', 'lib', 'gen', 'plan.json');
	if (!existsSync(at)) return null;
	const p = JSON.parse(readFileSync(at, 'utf8')) as { seed: number; peer?: GenPeer | null };
	return { seed: p.seed, peer: p.peer ?? null };
})();
const GEN_PEER = GEN?.peer ?? null;
const PEERS = (arg('--peers') ?? (GEN_PEER ? `peer=${APP}-peer` : ''))
	.split(',')
	.filter(Boolean)
	.map((p) => {
		const [name, dir] = p.split('=');
		return {
			name,
			origin: `https://${name}.test`,
			output: join(resolve(dir), '.svelte-kit', 'output')
		};
	});

/** The run's federation: the app's environment, and its peers with theirs. */
function federation(seed: number): { env: Record<string, string>; peers: WorldOptions['peers'] } {
	if (PEERS.length === 0) return { env: {}, peers: [] };
	const r = rng(seed).fork('keys');
	const apps = [{ name: NAME, origin: ORIGIN }, ...PEERS].map((a) => ({ ...a, keys: key_pair(r) }));
	const common: Record<string, string> = {};
	for (const a of apps) {
		common[`${a.name.toUpperCase()}_PUBLIC_KEY`] = a.keys.pub;
		common[`${a.name.toUpperCase()}_ORIGIN`] = a.origin;
	}
	const env_of = (a: (typeof apps)[number]) => ({
		...common,
		ORIGIN: a.origin,
		[`${a.name.toUpperCase()}_SIGNING_KEY`]: a.keys.priv
	});
	return {
		env: env_of(apps[0]),
		peers: apps.slice(1).map((a, i) => ({
			origin: a.origin,
			build: { id: a.name, output: PEERS[i].output, env: env_of(a) }
		}))
	};
}
/** `--plan <file>`: one run of a seed with its workload spelled out (a search's or a shrink's run,
 *  as it wrote it: `{ seed, steps, plan }`). */
const PLANNED = ((): { seed: number; steps: number; plan: Plan } | null => {
	const at = arg('--plan');
	return at === undefined ? null : JSON.parse(readFileSync(at, 'utf8'));
})();
const FIRST = PLANNED?.seed ?? Number(arg('--seed') ?? arg('--from') ?? 1);
const RUNS =
	arg('--seed') !== undefined || PLANNED ? 1 : Number(arg('--runs') ?? (LONG ? 500 : 20));
const STEPS = PLANNED?.steps ?? Number(arg('--steps') ?? (LONG ? 40 : 12));
const STOP_AT = arg('--step') === undefined ? Infinity : Number(arg('--step'));

/** Real elapsed ms (the run replaces `performance.now` and `Date` with virtual time). */
const wall = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

/** The app's pages without parameters, from its route tree (groups `(x)` are not in the URL). */
function route_paths(app: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, url: string): void => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isFile() && e.name === '+page.svelte') out.push(url || '/');
			if (!e.isDirectory() || e.name.includes('[')) continue;
			walk(join(dir, e.name), /^\(.*\)$/.test(e.name) ? url : `${url}/${e.name}`);
		}
	};
	walk(join(app, 'src', 'routes'), '');
	return out.sort();
}
/** The paths the visitor goes to: the app's route tree, and `--paths /a,/b` (a programmatic
 *  router's, a mounted peer's pages, which no route file names). */
const PATHS = [
	...route_paths(APP),
	...(arg('--paths') ?? '').split(',').filter((p) => p.startsWith('/')),
	...(GEN_PEER?.pages ?? []).map((p) => MOUNT + p.path)
];
/** Paths an app's e2e serves itself (`page.route`), not its build: palaestra's /wake-gate holds a
 *  slow script its spec releases (e2e/wake-gate.spec.ts). */
const SUPPLIED = ['/wake-gate-slow.js'];
const FAULTS: FaultClass[] = ['delay', 'reorder', 'drop', 'duplicate', 'cut', 'tamper', 'redirect'];

/** FNV-1a, hex: a DOM's fingerprint in the trace. */
/** The visitor presses a button in it (once or twice, or as an outage starts). */
function presses(a: Action): boolean {
	return a.kind === 'press' || a.kind === 'twice' || (a.kind === 'outage' && a.during === 'press');
}

function fingerprint(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}

export interface RunResult {
	readonly seed: number;
	readonly faults: FaultClass[];
	readonly actions: Action[];
	readonly broken: Broken[];
	readonly steps: number;
	readonly ms: number;
	/** The full trace: loop tasks, actions, each tab's URL and DOM fingerprint, findings. */
	readonly log: string[];
	/** The buggify points that fired, `point×times`. */
	readonly buggified: string[];
	/** The machine steps the run's pages took and the buggify points it was asked about. */
	readonly coverage: RunCoverage;
	/** What the network did to the tabs' own requests to the app: the real-browser tier does it
	 *  again (apps/palaestra/e2e/sim-replay.spec.ts). */
	readonly wire: readonly WireFault[];
	/** What the visitor saw after each action (`--observe`), else empty. */
	readonly seen: readonly Seen[];
}

/** A request of tab `tab` (0 is the first) the network dropped or cut: the `nth` (from 0) of the
 *  tab's requests for `method path` (path and query). */
export interface WireFault {
	readonly tab: number;
	readonly method: string;
	readonly path: string;
	readonly nth: number;
	readonly kind: 'drop' | 'cut';
}

/** The run's {@link WireFault}s, from its exchanges in the order they were asked. */
function wire_faults(world: World): WireFault[] {
	const counts = new Map<string, number>();
	const out: WireFault[] = [];
	for (const e of world.network.exchanges) {
		const tab = /^tab-(\d+)#/.exec(e.from);
		const u = new URL(e.url);
		if (tab === null || u.origin !== ORIGIN) continue;
		const at = { tab: Number(tab[1]) - 1, method: e.method, path: u.pathname + u.search };
		const key = `${at.tab} ${at.method} ${at.path}`;
		const nth = counts.get(key) ?? 0;
		counts.set(key, nth + 1);
		const kind = e.status === 'dropped' ? 'drop' : e.cut ? 'cut' : null;
		if (kind !== null) out.push({ ...at, nth, kind });
	}
	return out;
}

/**
 * A run's workload spelled out, in place of the seed's own: these actions first, then (with a
 * `tail`) actions drawn from the stream `workload <tail>`, weighed by `mix`, up to the run's steps.
 * The world (faults, servers, deploys, buggify) is still the seed's. A search mutates a run this
 * way (its first actions, then a new tail), and a shrink drops actions from it.
 */
export interface Plan {
	readonly actions: readonly Action[];
	readonly tail?: string;
	readonly mix?: Mix;
}

/** `a`, on a tab the world has (a shrunk plan may have dropped the action that opened its tab). */
function on_a_tab(a: Action, tabs: number): Action {
	return 'tab' in a && a.tab >= tabs ? { ...a, tab: a.tab % Math.max(1, tabs) } : a;
}

/** One seeded run. */
export async function run(
	seed: number,
	steps = STEPS,
	stop_at = Infinity,
	/** Called once the world is at rest, before the end checks (a found bug's test looks here). */
	at_rest?: (world: World, visitor: Visitor) => Promise<void>,
	/** The workload, spelled out (default: the seed's). */
	plan?: Plan
): Promise<RunResult> {
	const r = rng(seed).fork('swarm');
	// swarm testing: each run turns on its own subset of fault classes
	const faults = FAULTS.filter(() => r.chance(0.4));
	// (stalls on a stream of their own: the swarm's other draws stay as they were)
	if (rng(seed).fork('swarm stall').chance(0.3)) faults.push('stall');
	// (a calm run draws the same, then drops it: its other draws stay the seed's)
	if (CALM) faults.length = 0;
	// and its own servers: sometimes two instances behind the front door (each request to the
	// seed's pick), their clocks up to 5 s apart
	const instances = r.chance(0.3) && !CALM ? 2 : 1;
	const skew = instances > 1 && r.chance(0.5) ? 5_000 : 0;
	// and how a deploy goes out: at once or rolling (old and new servers side by side for 10 s),
	// the old build's content-hashed files kept or gone, the CDN purged or not
	const rollover: Rollover = {
		window: r.chance(0.5) ? 10_000 : 0,
		old_files: r.chance(0.5),
		purge: r.chance(0.5)
	};
	// and whether the app set a stable secret (most do; without one, a deploy refuses old holes)
	const secret = r.chance(0.7) || CALM ? 'sim-secret' : undefined;
	const fed = federation(seed);
	const world = await World.make({
		seed,
		builds: BUILDS.map((b) => ({ ...b, env: { ...b.env, ...fed.env } })),
		peers: fed.peers,
		rollover,
		secret,
		faults: new Set(faults),
		// (an action takes up to its 30 s budget, and a run ends at rest after it: room for all)
		horizon: (steps + 2) * 60_000,
		supplied: SUPPLIED,
		instances,
		skew,
		buggify: BUGGIFY ? { on: 0.3, fires: 0.2 } : undefined
	});
	running = world;
	world.loop.note(
		`servers: ${instances}, clocks up to ${skew} ms apart, ${secret ? 'a stable secret' : 'no secret'}`
	);
	const actions: Action[] = [];
	const broken: Broken[] = [];
	/** The document each tab had when it was last pressed in (by tab name). */
	const pressed = new Map<string, number>();
	/** Each document's exchange count when a press or a deploy first came (by realm). */
	const disturbed = new Map<string, number>();
	const leaks = new Leaks();
	const log = world.loop;
	/** Machine steps the pages took, with how often. */
	const steps_taken: Record<string, number> = {};
	/** What the visitor saw after each action (`--observe`). */
	const seen: Seen[] = [];
	try {
		const v = world.visitor('visitor');
		// (the network's exchanges since the last check: a fault among them explains what was said)
		let since = 0;
		/** Each document's machine moves read so far (by realm): its log keeps only its last lines,
		 *  so it is read after every action. */
		const moves_read = new Map<string, number>();
		const hear_moves = (): void => {
			// (every document's, a left one's too: one replaced inside an action took steps too)
			const logs: Array<[string, string]> = v.tabs.flatMap((t) =>
				[...t.moves_by].map(([realm, read]): [string, string] => [realm, read()])
			);
			// (and each server's, the app's and its peers')
			for (const s of [...[...world.servers.values()].flat(), ...world.peers.values()])
				logs.push([`server ${s.build.id} ${s.name}`, s.moves()]);
			for (const [realm, text] of logs) {
				const { lines, total } = new_moves(text, moves_read.get(realm) ?? 0);
				moves_read.set(realm, total);
				for (const line of lines) {
					const s = step_of_move(line);
					if (s !== null) steps_taken[s] = (steps_taken[s] ?? 0) + 1;
				}
			}
		};
		/** Each tab looked at, after `what`: its DOM and what it holds in the trace, and the oracles. */
		const look = (what: string): void => {
			hear_moves();
			if (OBSERVE !== undefined)
				seen.push(
					observe(
						world,
						v,
						seen.length === 0 ? 'first load' : `${seen.length} ${actions.at(-1)?.kind}`,
						since
					)
				);
			for (const t of v.tabs) {
				const doc = t.page.mainFrame.document as unknown as Document;
				log.note(`${t.name} ${t.page.mainFrame.url} dom ${fingerprint(normalize(doc))}`);
				for (const line of [...t.errors, ...t.console])
					log.note(`${t.name} said ${line.split('\n')[0]}`);
				const h = t.held();
				log.note(
					`${t.name} holds ${h.listeners} listeners ${h.intervals} intervals ${h.observers} observers`
				);
				for (const b of [
					page_errors(t, world, since),
					hydrates_as_sent(t, world),
					no_foreign_html(t),
					page_rules(t, world),
					leaks.check(t, pressed.get(t.name) === t.documents),
					live_events(t, world)
				])
					// (a known one once: it is told again after every action while the bug stands)
					if (b && !(b.oracle === 'known' && broken.some((k) => k.detail.endsWith(b.detail))))
						broken.push({ ...b, detail: `after ${what}: ${b.detail}` });
				t.errors.length = 0;
				t.console.length = 0;
				t.said_by.clear();
			}
			since = world.network.exchanges.length;
			for (const u of [uncaught(world), server_rules(world)])
				if (u && !(u.oracle === 'known' && broken.some((k) => k.detail.endsWith(u.detail))))
					broken.push({ ...u, detail: `after ${what}: ${u.detail}` });
		};
		const first = world.tab(v);
		await world.go(first, 'goto', '/');
		// (the first document is looked at before the visitor acts: what it said is its own, judged
		// by its own faults, not the next document's; generated-app seed 88, a cut runtime whose
		// changed onerror text no longer read as ogygia's code)
		look('the first load');
		const wr = world.rng.fork(plan?.tail === undefined ? 'workload' : `workload ${plan.tail}`);
		const given = plan?.actions ?? [];
		const total = plan === undefined || plan.tail !== undefined ? steps : given.length;
		for (let i = 0; i < total && i < stop_at && !broken.some((b) => b.oracle !== 'known'); i++) {
			const a =
				i < given.length
					? on_a_tab(given[i], v.tabs.length)
					: next_action(
							wr,
							v.tabs.length,
							PATHS,
							world.deployed.length < BUILDS.length - 1,
							plan?.mix
						);
			// (a calm run leaves out what a real browser cannot play alike: the player does too)
			if (CALM && NOT_CALM.includes(a.kind)) continue;
			actions.push(a);
			log.note(`action ${i + 1}: ${describe(a)}`);
			// (what a press or a deploy does is on purpose: each document's asks are judged up to it)
			if (presses(a) || a.kind === 'deploy')
				for (const t of v.tabs)
					if (!disturbed.has(t.realm)) disturbed.set(t.realm, world.network.exchanges.length);
			// (an eager press comes once the next document is in: the marks are that document's)
			await act(world, v, a, ORIGIN, () => {
				for (const t of v.tabs) {
					if (!disturbed.has(t.realm)) disturbed.set(t.realm, world.network.exchanges.length);
					pressed.set(t.name, t.documents);
				}
			});
			// (a press changes an island's state: the document shows the visitor's own state from then
			// on, kept across client navigations, which no fresh load has; its next document is clean.
			// And it may change the server's (a cart, a counter a command bumps), which every other
			// tab's document predates: seed 221, /cart-b in another tab)
			if (presses(a)) for (const t of v.tabs) pressed.set(t.name, t.documents);
			look(describe(a));
			// (past its horizon the world stops: nothing after it would be a finding about the app)
			if (world.loop.now >= world.loop.horizon)
				broken.push({
					oracle: 'horizon',
					detail: `virtual time reached the run's horizon (${world.loop.horizon} ms) at action ${i + 1}`
				});
			// (a known one, a filed bug's, does not end the run: what comes after may be new)
			if (broken.some((b) => b.oracle !== 'known')) break;
		}
		// (a `--step` past the last action prints the trace through rest)
		if (broken.every((b) => b.oracle === 'known') && stop_at > total) {
			for (const t of v.tabs) world.network.offline(t.name, false);
			await world.rest();
			// (a wait on its way out is not a hang: a backoff of seconds is a page's one-shot timer,
			// due later than rest's 2 s. Time runs on while one is set, a minute at most, then rest)
			const until = Math.min(world.loop.now + 60_000, world.loop.horizon);
			while (
				world.loop.now < until &&
				world.loop.next_at <= until &&
				v.tabs.some((t) => t.platform?.pending().includes('timeout'))
			)
				await world.loop.step();
			await world.rest();
			hear_moves();
			await at_rest?.(world, v);
			// AT REST, every tab (a faulted one too: a failure must end a wait as surely as an
			// answer): no machine left mid-work, and ogygia's rules hold
			for (const t of v.tabs)
				for (const b of [
					stuck(t),
					page_rules(t, world),
					// (and every region shows something, unless a press made the page the visitor's own)
					pressed.get(t.name) === t.documents ? null : regions_show(t, world),
					// (and no hole that wakes on its own still shows its fallback, pressed or not: a press
					// changes what a region shows, never whether a hole is owed its answer)
					fallback_stands(t, world),
					// (and every live region was heard announcing the tick it shows, pressed or not: a press
					// changes a button's own count, which the oracle leaves out, never a tick)
					live_events(t, world),
					// (and every region on screen keeps its styles, pressed or not: a soft refresh is a
					// press, and it must not take a sheet out from under a region it keeps)
					styled_regions(t, world)
				])
					if (b) broken.push({ ...b, detail: `at rest: ${b.detail}` });
			for (const t of v.tabs) {
				// (a document a deploy failed a download of is degraded as a faulted one is: by the host.
				// One only an outage touched is back on the network, and owes what a fresh load shows:
				// THE OUTAGE OVER, the page recovers)
				const outage = outage_only(world, t);
				if (
					pressed.get(t.name) === t.documents ||
					(faulted(world, t) && !outage) ||
					world.skewed_for(t.realm)
				)
					continue;
				// (NO WASTE: a document the network or an outage touched asks again on purpose)
				const w = faulted(world, t) ? null : waste(world, t);
				if (w) broken.push(w);
				const b = await mpa_equivalent(world, v, t);
				if (b)
					broken.push(outage && b.oracle !== 'known' ? { ...b, oracle: 'outage-recovery' } : b);
			}
			// (NO WASTE in any document of the run, a left one's too, each up to what disturbed it)
			const asked = asked_twice_each(
				world,
				new Map(v.tabs.flatMap((t) => [...t.swaps_by])),
				disturbed
			);
			if (asked) broken.push(asked);
			const c = no_cross_visitor_cache(world);
			if (c) broken.push(c);
			// GOOD HTML: what the servers sent, and what each tab's document is at rest (one the network
			// changed set aside)
			const sent = await html_sent(world);
			if (sent) broken.push(sent);
			for (const t of v.tabs) {
				if (document_faulted(world, t)) continue;
				const kept = html_kept(t);
				if (kept) broken.push({ ...kept, detail: `${t.page.mainFrame.url}: ${kept.detail}` });
			}
		}
		for (const b of broken) log.note(`broken ${b.oracle}: ${b.detail}`);
		const buggified = [...world.buggified]
			.filter(([, b]) => b.fired > 0)
			.map(([point, b]) => `${point}×${b.fired}`)
			.sort();
		return {
			seed,
			faults,
			actions,
			broken,
			steps: world.loop.ran,
			ms: 0,
			log: world.loop.log,
			buggified,
			coverage: { steps: steps_taken, points: Object.fromEntries(world.buggified) },
			wire: wire_faults(world),
			seen
		};
	} finally {
		await world.end();
	}
}

/** The first line where two traces differ, with a little before it; '' when they are equal. */
export function trace_difference(a: readonly string[], b: readonly string[]): string {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	if (i === a.length && i === b.length) return '';
	const from = Math.max(0, i - 3);
	return [
		`at line ${i + 1} of ${a.length} / ${b.length}:`,
		...a.slice(from, i + 2).map((l, k) => `${from + k === i ? '-' : ' '} ${l}`),
		'  ---',
		...b.slice(from, i + 2).map((l, k) => `${from + k === i ? '+' : ' '} ${l}`)
	].join('\n');
}

/** The repository root (the machines' source, for coverage's targets). */
const ROOT = resolve(import.meta.dirname, '..', '..', '..');

/** What runs reached, against every machine step of the packages: a line to print, and the numbers
 *  for results.json (each machine a run touched, with the steps it still misses). */
function coverage_summary(covered: Coverage) {
	const machines = universe(ROOT);
	const r = covered.report(machines);
	const unreached_recovery = covered.unreached_recovery(machines);
	const points = [...covered.points].map(([point, c]) => ({ point, ...c }));
	const fired = points.filter((p) => p.fired > 0).length;
	return {
		line: `coverage: ${r.reached}/${r.total} machine steps (${Math.round((r.reached / r.total) * 100)}%), ${r.machines_touched}/${r.per_machine.length} machines touched, ${unreached_recovery.length} recovery steps unreached; buggify: ${fired}/${points.length} points fired (${points.map((p) => `${p.point} ${p.fired}/${p.asked}`).join(', ') || 'none asked'})`,
		reached: r.reached,
		total: r.total,
		machines_touched: r.machines_touched,
		machines: r.per_machine
			.filter((m) => m.reached > 0)
			.map((m) => ({ name: m.name, reached: m.reached, total: m.total, missing: m.missing })),
		untouched: r.per_machine.filter((m) => m.reached === 0).map((m) => `${m.pkg}/${m.name}`),
		/** Every machine step reached, for the steps ledger (src/steps.ts `--sweep`). */
		steps_reached: [...all_steps(machines)].filter((s) => covered.steps.has(s)).sort(),
		unknown: r.unknown,
		/** Recovery steps (a retry, an offline wait, a failure, a give-up, a keep running out) no run
		 *  reached: each wants a buggify point, a fault or an app shape that leads there. */
		unreached_recovery,
		points
	};
}

/** A run, timed in real ms. */
async function timed(
	seed: number,
	steps: number,
	stop_at: number,
	plan?: Plan
): Promise<RunResult> {
	const t = wall();
	const res = await run(seed, steps, stop_at, undefined, plan);
	return { ...res, ms: wall() - t };
}

/** `--guided N`: a coverage-guided search of N runs (else: seeds in order). */
const GUIDED = Number(arg('--guided') ?? 0);
/** Where a search writes each failing run's plan (`--plan` replays it). */
const PLANS = join(import.meta.dirname, '..', 'plans');

/** A plan file (`--plan`, `--shrink`, and the real-browser tier's `SIM_PLANS`): the run's seed,
 *  workload and app (a generated one's seed: `gen`), what the network did to its requests, and
 *  what it found. */
function plan_json(seed: number, plan: Plan, res: RunResult): string {
	const found = res.broken.map((b) => `[${b.oracle}] ${b.detail.split('\n')[0]}`);
	const gen = GEN?.seed;
	return `${JSON.stringify({
		seed,
		steps: plan.actions.length,
		plan,
		app: APP,
		gen,
		wire: res.wire,
		found
	})}\n`;
}

/** A run the search keeps: it reached something no run before it had. */
interface Kept {
	readonly seed: number;
	readonly plan: Plan;
	/** How much it reached first (steps, fired points): a parent is picked by it. */
	readonly found: number;
}

/** A swarm over the workload: some kinds of action off for the run, some heavy. */
function swarm_mix(g: Rng): Mix {
	const mix: Partial<Record<Action['kind'], number>> = {};
	for (const kind of ACTION_KINDS)
		mix[kind] =
			kind === 'wait'
				? 1
				: g.weighted<number>([
						[0, 1],
						[1, 2],
						[3, 1]
					]);
	return mix;
}

/**
 * THE COVERAGE-GUIDED SEARCH. A run that reaches a machine step or fires a buggify point no run
 * before it had is kept, as its seed and its actions. Most next runs mutate a kept one: its world
 * (the seed's), its first actions up to a random cut, then a new tail drawn from a stream of its
 * own, half the time under a new mix of actions (a swarm over what the visitor does). The rest are
 * fresh seeds. A failure's plan is written to `internal/sim/plans/` and run again from the plan
 * alone (`--plan` replays it, and must give the same trace). The search's choices depend on which
 * run ends first, so the search itself does not replay; each run in it does.
 */
async function guided(): Promise<void> {
	mkdirSync(join(PLANS, 'kept'), { recursive: true });
	const started = wall();
	const pool = new Pool(JOBS);
	const g = rng(FIRST).fork('guided');
	const covered = new Coverage();
	const kept: Kept[] = [];
	const fresh_first = Math.min(GUIDED, Math.max(JOBS, 8));
	let next_seed = FIRST;
	let made = 0;
	let ran = 0;
	let failed = 0;
	let leaks = 0;
	const next = (): { seed: number; plan?: Plan; label: string } => {
		made++;
		if (made <= fresh_first || kept.length === 0 || g.chance(0.25)) {
			const seed = next_seed++;
			return { seed, label: `seed ${seed}` };
		}
		const parent = g.weighted<Kept>(kept.map((k) => [k, 1 + k.found]));
		const cut = g.int(parent.plan.actions.length + 1);
		const tail = `m${made}`;
		const mix = g.chance(0.5) ? swarm_mix(g) : parent.plan.mix;
		return {
			seed: parent.seed,
			plan: { actions: parent.plan.actions.slice(0, cut), tail, mix },
			label: `seed ${parent.seed} ${tail} (${cut} kept${mix ? ', mixed' : ''})`
		};
	};
	const done = async (
		c: { seed: number; plan?: Plan; label: string },
		res: RunResult,
		worker: number
	): Promise<void> => {
		ran++;
		const plan: Plan = { actions: res.actions, mix: c.plan?.mix };
		const fresh = covered.add(res.coverage);
		if (fresh.length > 0) {
			kept.push({ seed: c.seed, plan, found: fresh.length });
			// (the interesting runs, for the real-browser tier: apps/palaestra/e2e/sim-replay.spec.ts)
			writeFileSync(
				join(PLANS, 'kept', `${c.label.replace(/\W+/g, '-')}.json`),
				plan_json(c.seed, plan, res)
			);
		}
		const bad = res.broken.filter((b) => b.oracle !== 'known');
		if (fresh.length > 0 || bad.length > 0)
			console.log(
				`${bad.length ? 'FAIL' : 'new '} ${c.label}: ${res.actions.length} actions${fresh.length ? `, ${fresh.length} new: ${fresh.slice(0, 4).join('; ')}${fresh.length > 4 ? '; …' : ''}` : ''}`
			);
		if (bad.length === 0) return;
		failed++;
		const file = join(PLANS, `${c.label.replace(/[^\w]+/g, '-').replace(/-$/, '')}.json`);
		writeFileSync(file, plan_json(c.seed, plan, res));
		for (const b of bad) console.log(`  [${b.oracle}] ${b.detail.split('\n').join('\n    ')}`);
		// (its plan alone gives the same run: what `--plan` replays)
		const again = await pool.run(c.seed, res.actions.length, Infinity, worker, plan);
		const diff = trace_difference(res.log, again.result.log);
		if (diff !== '') leaks++;
		console.log(
			`  plan: ${file}${diff === '' ? ' (replays the same)' : `\n  the plan's replay DIFFERS:\n    ${diff.split('\n').join('\n    ')}`}`
		);
	};
	await new Promise<void>((all_done) => {
		let flying = 0;
		const pump = (): void => {
			while (flying < JOBS && made < GUIDED) {
				const c = next();
				flying++;
				void pool.run(c.seed, STEPS, Infinity, -1, c.plan).then(async ({ result, worker }) => {
					await done(c, result, worker);
					flying--;
					if (ran % 50 === 0) console.log(`[${ran} runs] ${coverage_summary(covered).line}`);
					if (flying === 0 && made >= GUIDED) all_done();
					else pump();
				});
			}
		};
		pump();
	});
	pool.end();
	const coverage = coverage_summary(covered);
	const seconds = Math.round((wall() - started) / 100) / 10;
	writeFileSync(
		join(import.meta.dirname, '..', 'results.json'),
		`${JSON.stringify(
			{
				app: APP,
				guided: GUIDED,
				from: FIRST,
				failed,
				plan_leaks: leaks,
				seconds,
				kept: kept.length,
				coverage
			},
			null,
			'\t'
		)}\n`
	);
	console.log(
		`\n${GUIDED} guided runs (${next_seed - FIRST} fresh seeds, ${kept.length} kept), ${failed} failed, ${leaks} plan replay leaks, ${seconds} s`
	);
	console.log(coverage.line);
	process.exitCode = failed || leaks ? 1 : 0;
}

/** `--shrink <plan file>`: a failing run's plan (a search's, or `{ seed, steps, plan }` by hand). */
const SHRINK = arg('--shrink');
/** `--known`: a shrink may take a filed bug's finding (`known`) when the run finds nothing new. */
const KNOWN_TOO = process.argv.includes('--known');

/**
 * Shrinks a failing run to the fewest actions that fail the same way (src/shrink.ts), replays the
 * shrunk run twice (its traces must be equal), prints its actions, its finding and its trace's
 * tail, and writes its plan (`plans/<name>.min.json`, for `--plan`) and its regression test
 * (`test/found/<name>.test.ts`, which fails while the bug stands).
 */
async function shrink(file: string): Promise<void> {
	const given = JSON.parse(readFileSync(file, 'utf8')) as {
		seed: number;
		steps?: number;
		plan?: Plan;
	};
	const seed = given.seed;
	const pool = new Pool(JOBS);
	// (no plan: the seed's own workload, of `steps` actions, spelled out by its run)
	const plan: Plan =
		given.plan ??
		({ actions: (await pool.run(seed, given.steps ?? STEPS, Infinity)).result.actions } as Plan);
	const ran = (actions: readonly Action[], avoid = -1) =>
		pool.run(seed, actions.length, Infinity, avoid, { actions, mix: plan.mix });
	const first = (await ran(plan.actions)).result;
	// (a new finding first; else a filed one's, to shrink its repro)
	const bad =
		first.broken.find((b) => b.oracle !== 'known') ?? (KNOWN_TOO ? first.broken[0] : undefined);
	if (bad === undefined) {
		pool.end();
		console.log(
			`seed ${seed}: its ${plan.actions.length} actions find nothing new: nothing to shrink (\`--known\` shrinks a filed bug's)`
		);
		process.exitCode = 1;
		return;
	}
	const target = signature(bad);
	console.log(`[shrink] seed ${seed}, ${plan.actions.length} actions: [${bad.oracle}] ${target}`);
	// (the signature names the oracle: `known` for a filed bug's)
	const fails = (r: RunResult) => r.broken.some((b) => signature(b) === target);
	const check = (candidates: ReadonlyArray<readonly Action[]>) =>
		Promise.all(candidates.map((a) => ran(a).then((x) => fails(x.result))));
	let { items, runs } = await ddmin(plan.actions, check);
	// (the first load alone, with no action at all)
	if (items.length === 1 && (await check([[]]))[0]) items = [];
	runs++;
	const a = await ran(items);
	const b = await ran(items, a.worker);
	pool.end();
	const diff = trace_difference(a.result.log, b.result.log);
	const found = a.result.broken.find((k) => signature(k) === target);
	if (found === undefined || diff !== '') {
		console.log(
			found === undefined
				? `[shrink] the shrunk run no longer fails the same way (${runs} runs): a flaky finding`
				: `[shrink] the shrunk run's replay DIFFERS:\n${diff}`
		);
		process.exitCode = 1;
		return;
	}
	const name = slug(found.oracle, target);
	// (as the run took them: on the tabs it had)
	items = a.result.actions;
	const min: Plan = { actions: items, mix: plan.mix };
	mkdirSync(PLANS, { recursive: true });
	const plan_file = join(PLANS, `${name}.min.json`);
	writeFileSync(plan_file, plan_json(seed, min, a.result));
	const gen = GEN?.seed ?? null;
	const test_file = join(import.meta.dirname, '..', 'test', 'found', `${name}.test.ts`);
	mkdirSync(join(test_file, '..'), { recursive: true });
	if (!existsSync(test_file))
		writeFileSync(
			test_file,
			regression_test({
				name,
				app: relative(ROOT, APP),
				gen,
				seed,
				plan: min,
				oracle: found.oracle,
				signature: target,
				detail: found.detail,
				actions: items.map(describe)
			})
		);
	console.log(
		[
			`[shrink] ${plan.actions.length} actions to ${items.length}, in ${runs} runs; it replays the same`,
			...items.map((x, i) => `  ${i + 1}. ${describe(x)}`),
			`  [${found.oracle}] ${found.detail.split('\n').join('\n    ')}`,
			"  the trace, last 40 lines (less the network's body chunks):",
			...a.result.log
				.filter((l) => !/ net (chunk|end) /.test(l))
				.slice(-40)
				.map((l) => `    ${l}`),
			`  plan: ${plan_file}  (pnpm sim --app ${APP} --plan ${plan_file} --step ${items.length})`,
			`  test: ${test_file}`
		].join('\n')
	);
}

async function main(): Promise<void> {
	if (SHRINK !== undefined) return shrink(SHRINK);
	if (!existsSync(join(BUILDS[0].output, 'server', 'index.js'))) {
		console.error(
			`no build at ${OUTPUT}: run \`pnpm sim:builds\` (two builds, with deploys) or \`OGYGIA_RULES=1 npx vite build\` in ${APP}`
		);
		process.exit(2);
	}
	if (BUILDS.length === 1) console.log('[sim] one build: no deploys (`pnpm sim:builds` makes two)');
	if (GUIDED > 0) return guided();
	const started = wall();
	const pool = new Pool(JOBS);
	const seeds = Array.from({ length: RUNS }, (_, i) => FIRST + i);
	// each seed's first run, and its replay (on another worker where there are two)
	const runs = seeds.map(async (seed): Promise<[RunResult, RunResult | null]> => {
		const plan = PLANNED?.plan;
		const first = await pool.run(seed, STEPS, STOP_AT, -1, plan);
		const again = REPLAY ? await pool.run(seed, STEPS, STOP_AT, first.worker, plan) : null;
		return [first.result, again?.result ?? null];
	});
	const results: RunResult[] = [];
	const leaks: Array<{ seed: number; difference: string }> = [];
	let failed = 0;
	let known = 0;
	// reported in seed order, each as soon as it and every seed before it are done
	for (const [i, pending] of runs.entries()) {
		const [res, again] = await pending;
		const seed = seeds[i];
		results.push(res);
		if (OBSERVE !== undefined && res.seen.length > 0) {
			const out: Observed = {
				app: APP,
				seed,
				gen: GEN?.seed,
				plan: { actions: res.actions },
				by: 'sim',
				seen: res.seen
			};
			mkdirSync(OBSERVE, { recursive: true });
			writeFileSync(join(OBSERVE, `${basename(APP)}-${seed}.sim.json`), `${JSON.stringify(out)}\n`);
		}
		let replay = '';
		if (again !== null) {
			results.push(again);
			const diff = trace_difference(res.log, again.log);
			replay = diff === '' ? '  replay: same' : '  replay: DIFFERENT';
			if (diff !== '') leaks.push({ seed, difference: diff });
		}
		const fresh = res.broken.filter((b) => b.oracle !== 'known');
		const mark = fresh.length ? 'FAIL' : res.broken.length ? 'KNWN' : 'ok  ';
		console.log(
			`${mark} seed ${seed}  ${res.actions.length} actions, ${res.steps} loop steps, ${Math.round(res.ms)} ms  faults: ${res.faults.join(',') || 'none'}${res.buggified.length ? `  buggify: ${res.buggified.join(',')}` : ''}${replay}`
		);
		if (STOP_AT !== Infinity) console.log(res.log.join('\n'));
		const leak = leaks.find((l) => l.seed === seed);
		if (leak)
			console.log(
				`  the replay differs (a nondeterminism leak):\n    ${leak.difference.split('\n').join('\n    ')}`
			);
		if (fresh.length) failed++;
		else if (res.broken.length) known++;
		if (res.broken.length) {
			if (fresh.length)
				console.log(res.actions.map((a, i) => `  ${i + 1}. ${describe(a)}`).join('\n'));
			for (const b of res.broken)
				console.log(`  [${b.oracle}] ${b.detail.split('\n').join('\n    ')}`);
		}
	}
	pool.end();
	const covered = new Coverage();
	for (const r of results.filter((_, i) => !REPLAY || i % 2 === 0)) covered.add(r.coverage);
	const coverage = coverage_summary(covered);
	const steps = results.reduce((n, r) => n + r.steps, 0);
	const actions = results.reduce((n, r) => n + r.actions.length, 0);
	const elapsed = wall() - started;
	const summary = {
		app: APP,
		runs: RUNS,
		jobs: JOBS,
		failed,
		known,
		replay_checked: REPLAY,
		replay_leaks: leaks.map((l) => l.seed),
		loop_steps: steps,
		seconds: Math.round(elapsed / 100) / 10,
		/** Loop steps per real second, over the whole pool (the replay runs included). */
		steps_per_second: Math.round((steps / elapsed) * 1000),
		actions_per_second: Math.round((actions / elapsed) * 10000) / 10,
		coverage,
		seeds_failed: results
			.filter((r, i) => r.broken.length && (!REPLAY || i % 2 === 0))
			.map((r) => ({ seed: r.seed, oracles: r.broken.map((b) => b.oracle) })),
		/** What each failing seed found (not what a filed bug explains), for the scheduled run's
		 *  triage (src/ci.ts): enough to file it, replay it and write its test. */
		findings: results
			.filter((_, i) => !REPLAY || i % 2 === 0)
			.flatMap((r) =>
				r.broken
					.filter((b) => b.oracle !== 'known')
					.map((b) => ({
						seed: r.seed,
						steps: STEPS,
						oracle: b.oracle,
						detail: b.detail,
						faults: r.faults,
						actions: r.actions.map(describe),
						trace_tail: r.log.slice(-40)
					}))
			)
	};
	writeFileSync(
		join(import.meta.dirname, '..', 'results.json'),
		`${JSON.stringify(summary, null, '\t')}\n`
	);
	console.log(
		`\n${RUNS} seeds, ${failed} failed, ${known} known, ${leaks.length} replay leaks, ${JOBS} jobs, ${summary.seconds} s, ${summary.steps_per_second} loop steps/s, ${summary.actions_per_second} actions/s`
	);
	console.log(coverage.line);
	// (not `process.exit`: it cuts a long trace short on a pipe)
	process.exitCode = failed || leaks.length ? 1 : 0;
}

const JOBS = Math.max(
	1,
	Number(arg('--jobs') ?? Math.min(RUNS * (REPLAY ? 2 : 1), availableParallelism() - 1))
);
/** Runs a worker takes before it is replaced (each world's server graph stays loaded). */
const WORKER_RUNS = 25;

interface Job {
	seed: number;
	steps: number;
	stop_at: number;
	plan?: Plan;
	/** A worker not to use (the one that ran the seed first), when another is free. */
	avoid: number;
	resolve(r: { result: RunResult; worker: number }): void;
}

interface Worker {
	readonly id: number;
	readonly child: ChildProcess;
	runs: number;
	/** The tail of its stderr. */
	said: string;
}

/** A worker's arguments: the batch's own, every one (a worker reads its options as the batch
 *  does: a list of the ones it needs left out `--paths`, `--name` and `--peers`), the batch's
 *  working directory its own. test/pool.test.ts. */
export function worker_args(batch: readonly string[]): string[] {
	return ['--worker', ...batch];
}

/** Worker processes, each running one world at a time. */
class Pool {
	readonly #queue: Job[] = [];
	readonly #idle: Worker[] = [];
	#made = 0;
	#live = 0;
	readonly #size: number;

	constructor(size: number) {
		this.#size = size;
	}

	run(
		seed: number,
		steps: number,
		stop_at: number,
		avoid = -1,
		plan?: Plan
	): Promise<{ result: RunResult; worker: number }> {
		return new Promise((resolve) => {
			this.#queue.push({ seed, steps, stop_at, plan, avoid, resolve });
			this.#pump();
		});
	}

	#spawn(): Worker {
		const child = fork(import.meta.filename, worker_args(process.argv.slice(2)), {
			execArgv: ['--experimental-vm-modules', '--no-warnings'],
			stdio: ['ignore', 'ignore', 'pipe', 'ipc']
		});
		this.#live++;
		const w: Worker = { id: ++this.#made, child, runs: 0, said: '' };
		// (what it last wrote to stderr: why it died, if it dies)
		child.stderr?.on('data', (d: Buffer) => {
			w.said = (w.said + d.toString()).slice(-4000);
		});
		return w;
	}

	/** Hands queued jobs to free workers. A replay waits for another worker than its first run's
	 *  (one is always busy or can be made, unless the pool has one). */
	#pump(): void {
		next: while (this.#queue.length > 0) {
			for (const [i, w] of this.#idle.entries()) {
				const at = this.#queue.findIndex((j) => j.avoid !== w.id || this.#size === 1);
				if (at === -1) continue;
				this.#idle.splice(i, 1);
				this.#send(w, this.#queue.splice(at, 1)[0]);
				continue next;
			}
			if (this.#live >= this.#size) return;
			this.#send(this.#spawn(), this.#queue.shift()!);
		}
	}

	#send(w: Worker, job: Job): void {
		// (a run that throws, or a worker that dies, is the seed's finding: the simulator's own
		// failure, to be triaged like any other, and the pool goes on)
		const crashed = (why: string, oracle = 'crash'): { result: RunResult; worker: number } => ({
			worker: w.id,
			result: {
				seed: job.seed,
				faults: [],
				actions: [],
				broken: [{ oracle, detail: why }],
				steps: 0,
				ms: 0,
				log: [`${oracle}: ${why.split('\n')[0]}`],
				buggified: [],
				coverage: { steps: {}, points: {} },
				wire: [],
				seen: []
			}
		});
		const done = (message: { result?: RunResult; error?: string; hung?: string }) => {
			w.child.off('exit', died);
			job.resolve(
				message.hung !== undefined
					? crashed(message.hung, 'hung')
					: message.result === undefined
						? crashed(`the run threw: ${message.error}`)
						: { result: message.result, worker: w.id }
			);
			// (a hung run's worker ends itself)
			if (message.hung !== undefined || ++w.runs >= WORKER_RUNS) {
				w.child.kill();
				this.#live--;
			} else this.#idle.push(w);
			this.#pump();
		};
		const died = (code: number | null) => {
			w.child.off('message', done);
			this.#live--;
			job.resolve(
				crashed(`its worker exited (${code}) after ${w.runs} runs; it last said:\n${w.said}`)
			);
			this.#pump();
		};
		w.child.once('message', done);
		w.child.once('exit', died);
		w.child.send({ seed: job.seed, steps: job.steps, stop_at: job.stop_at, plan: job.plan });
	}

	end(): void {
		for (const w of this.#idle) w.child.kill();
		this.#idle.length = 0;
	}
}

/** A worker: runs the seeds it is sent, one at a time, and sends each result back. */
function worker(): void {
	// (the pool went away: nothing more will come)
	process.on('disconnect', () => process.exit(0));
	process.on('message', (job: { seed: number; steps: number; stop_at: number; plan?: Plan }) => {
		// THE WATCHDOG: a run that has not ended after HANG_MS of real time is hung (a wait nobody
		// will ever end: the simulator's, or the app's). What it was waiting on goes back as its
		// finding, and the worker ends: its host is in a state no next run should meet.
		const watchdog = real_timeout(() => {
			process.send!({ hung: hung_report(job.seed) }, () => process.exit(3));
		}, HANG_MS);
		timed(job.seed, job.steps, job.stop_at ?? Infinity, job.plan).then(
			(result) => {
				clearRealTimeout(watchdog);
				process.send!({ result });
			},
			(error: unknown) => {
				clearRealTimeout(watchdog);
				process.send!({ error: String((error as Error)?.stack ?? error) });
			}
		);
	});
}

/** Real ms a run may take before it is called hung (a 40-action run takes a few seconds). */
const HANG_MS = Number(arg('--hang-ms') ?? 60_000);

/** The world of the run in progress (for a hung run's report). */
let running: World | null = null;

/** What a hung run was doing: where it stood, what was queued, what was on the wire, the trace's
 *  tail, and each tab's machine moves (`__ogygia_moves`, with rules on). */
function hung_report(seed: number): string {
	const w = running;
	if (w === null) return `seed ${seed}: hung before its world was made`;
	const lines: string[] = [];
	const actions = w.loop.log.filter((l) => l.includes(' # action '));
	lines.push(
		`seed ${seed}: hung at virtual ${w.loop.now} ms, ${w.loop.ran} loop steps, ${actions.length} actions begun (last: ${actions.at(-1) ?? 'none'})`
	);
	const queued = w.loop.queued();
	lines.push(`queued tasks (${queued.length}), first 20:`);
	for (const t of queued.slice(0, 20)) lines.push(`  ${t.at} ${t.realm} ${t.label}`);
	const wire = w.network.exchanges.filter((e) => e.status === 'pending');
	lines.push(`requests with no answer yet (${wire.length}):`);
	for (const e of wire.slice(-20)) lines.push(`  ${e.id} ${e.from} ${e.method} ${e.url}`);
	lines.push(
		`host real timers at the last settle: ${w.loop.real_timers}, settles that gave up: ${w.loop.stalls}`
	);
	lines.push(`host resources now: ${process.getActiveResourcesInfo().join(', ')}`);
	lines.push('trace tail:', ...w.loop.log.slice(-40).map((l) => `  ${l}`));
	for (const v of w.browsers.visitors)
		for (const t of v.tabs) {
			const win = t.page.mainFrame.window as unknown as { __ogygia_moves?: () => string };
			const moves = win.__ogygia_moves?.().split('\n').slice(-15) ?? [];
			lines.push(`${v.name} ${t.name} ${t.page.mainFrame.url}: last machine moves:`);
			lines.push(...moves.map((m) => `  ${m}`));
		}
	return lines.join('\n');
}

if (import.meta.main) {
	if (process.argv.includes('--worker')) worker();
	else await main();
}
