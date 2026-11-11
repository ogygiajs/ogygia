// STALE PASSES THROUGH A WAIT (#378): if anything a wait waited on is stale, the whole wait is.
// The awaited value is `STALE` itself, or an array (the `Promise.all` shape) with `STALE` among its
// items: the wait gives `STALE`. One level deep: objects and nested arrays are not scanned.
// Each wait gets a flight dropped while it is out, inside a `Promise.all`, with real timers.
import { describe, expect, it } from 'vitest';
import { flights, machine, mailbox, policy, scope, stage, STALE } from '../src/index.ts';
import { under_policy } from '../src/policy.ts';

const later = <T>(value: T, ms = 1) => new Promise<T>((r) => setTimeout(() => r(value), ms));

/** A flight dropped 1 ms in, and only then answered: its caller gets `STALE`. (The answer waits on
 *  the drop, so a busy machine can never land it first.) */
function dropped_flight(): Promise<string | typeof STALE> {
	let answer: ((v: string) => void) | undefined;
	const f = flights({ run: () => new Promise<string>((r) => (answer = r)) });
	const got = f.get();
	setTimeout(() => {
		f.drop(undefined as never);
		answer?.('page');
	}, 1);
	return got;
}

/** What each wait is handed: a kept value beside a dropped flight. */
const parts = () => Promise.all([later('module', 2), dropped_flight()]);

describe('a stale part makes the whole wait stale (#378)', () => {
	it('scope.task', async () => {
		expect(await scope().task(parts)).toBe(STALE);
	});

	it('a machine visit’s scope.task', async () => {
		const m = machine<{ on: {}; off: {} }>()({
			name: 'stale-waits',
			initial: 'on',
			steps: { on: ['off'], off: [] }
		}).create();
		expect(await m.scope.task(parts)).toBe(STALE);
		m.stop();
	});

	it('a mailbox turn’s wait, an outside wait and an ask', async () => {
		const box = mailbox(scope());
		expect(await box.ask((turn) => turn.wait(parts()))).toBe(STALE);
		expect(await box.wait(parts())).toBe(STALE);
		expect(await box.ask(() => parts())).toBe(STALE);
	});

	it('stage().ready', async () => {
		const next = stage(scope(), { build: parts, commit: () => {} });
		expect(await next.ready).toBe(STALE);
		expect(next.commit()).toBe(false);
	});

	it('under_policy', async () => {
		const p = policy({ attempts: 2, backoff: 0, jitter: 0, deadline: Infinity });
		expect(await under_policy(p, parts)).toBe(STALE);
	});

	it('a flights run: its callers get STALE, and nothing is kept (#377)', async () => {
		let runs = 0;
		const f = flights({
			run: () => {
				runs++;
				return runs === 1 ? parts() : Promise.all([later('module', 2), later('page', 2)]);
			}
		});
		expect(await f.get()).toBe(STALE);
		expect(f.peek(undefined as never)).toBeUndefined();
		// (the key is free: the next get runs again)
		expect(await f.get()).toEqual(['module', 'page']);
		expect(runs).toBe(2);
	});

	it('a STALE answer of its own: the wait is STALE, and nothing is kept (#377)', async () => {
		let stale = true;
		const f = flights({ run: () => (stale ? STALE : 'v') });
		expect(await f.get()).toBe(STALE);
		stale = false;
		expect(await f.get()).toBe('v');
	});

	it('a fresh flight that answers STALE gives the kept answer back', async () => {
		let answer: string | typeof STALE = 'old';
		const f = flights({ run: () => answer });
		expect(await f.get()).toBe('old');
		answer = STALE;
		expect(await f.get(undefined, { fresh: true })).toBe(STALE);
		expect(f.peek(undefined as never)).toMatchObject({
			kind: 'kept',
			answer: 'old',
			flying: false
		});
		expect(await f.get()).toBe('old');
	});
});

describe('only one level deep, only arrays', () => {
	it('an array with no STALE comes through as it is', async () => {
		const v = await scope().task(() => Promise.all([1, later(2)]));
		expect(v).toEqual([1, 2]);
	});

	it('objects and nested arrays are not scanned', async () => {
		const s = scope();
		const obj = await s.task(() => ({ a: STALE }));
		expect(obj).toEqual({ a: STALE });
		const nested = await s.task(() => [[STALE]]);
		expect(nested).toEqual([[STALE]]);
	});
});
