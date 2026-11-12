// Already-stamped events enter the devtools stream two ways (events/bus.ts):
// - the page's side channel (`application/ogygia-devtools`, events/sinks.ts): JSON the page carries,
//   so only well-formed SERVER events get in (`ingest_page_events`), never null, a number, or an
//   event that claims the client realm;
// - `ingest`, the public door (a saved trace, another realm): every well-formed event, of either
//   realm, and nothing malformed. A saved trace holds client events (navigation, wake), and replaying
//   it must keep them (devtools/test/devtools-last-nav.test.ts reads them back).
import { beforeEach, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';

(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
const bus = await import('../src/events/bus.ts');
const { ingest, snapshot, clear, configure } = bus;
const { ingest_page_events } = bus as unknown as {
	ingest_page_events: (events: readonly unknown[]) => number;
};

const DOMAINS = ['compile', 'server', 'wire', 'runtime', 'hub', 'nav'];

beforeEach(() => {
	clear();
	configure({ active: true, cap: 4096 });
});

/** Mostly the right thing, sometimes any JSON scalar in its place. */
const near = <T>(good: fc.Arbitrary<T>) =>
	fc.oneof({ arbitrary: good, weight: 8 }, { arbitrary: fc.jsonValue({ maxDepth: 0 }), weight: 1 });

const event_like = fc.record(
	{
		v: near(fc.constant(1)),
		seq: near(fc.nat()),
		t: near(fc.double({ noNaN: true, noDefaultInfinity: true })),
		realm: near(fc.constantFrom('server', 'server', 'client')),
		domain: near(fc.constantFrom(...DOMAINS)),
		name: near(fc.constantFrom('server.render', 'runtime.boot')),
		fp: fc.string({ maxLength: 8 })
	},
	{ requiredKeys: ['v', 'seq', 't', 'realm', 'domain', 'name'] }
);
const raw_events = fc.array(fc.oneof(event_like, fc.jsonValue({ maxDepth: 2 })), { maxLength: 8 });

/** `e` as the stream must hold it, whatever came in; returns its realm. */
function well_formed(e: unknown): string {
	expect(e !== null && typeof e === 'object' && !Array.isArray(e)).toBe(true);
	const o = e as Record<string, unknown>;
	expect(['server', 'client']).toContain(o.realm);
	expect(DOMAINS).toContain(o.domain);
	expect(typeof o.name).toBe('string');
	for (const k of ['v', 'seq', 't']) expect(Number.isFinite(o[k]), k).toBe(true);
	return o.realm as string;
}

it('only well-formed server events enter the stream from the page, whatever its side channel holds', () => {
	let kept = 0;
	fc.assert(
		fc.property(raw_events, (raw) => {
			clear();
			// as the page carries it: JSON text read back
			ingest_page_events(JSON.parse(JSON.stringify(raw)));
			for (const e of snapshot()) {
				kept++;
				expect(well_formed(e)).toBe('server');
			}
		}),
		{ numRuns: 300 }
	);
	expect(kept, 'some generated events were well formed').toBeGreaterThan(10);
});

it('ingest keeps every well-formed event of either realm (a saved trace replays whole), nothing else', () => {
	const realms = new Set<string>();
	fc.assert(
		fc.property(raw_events, (raw) => {
			clear();
			const given = JSON.parse(JSON.stringify(raw)) as unknown[];
			ingest(given);
			const kept = snapshot();
			for (const e of kept) realms.add(well_formed(e));
			// every well-formed one is kept, in order
			const expected = given.filter((g) => {
				try {
					well_formed(g);
					return true;
				} catch {
					return false;
				}
			});
			expect(kept).toEqual(expected);
		}),
		{ numRuns: 300 }
	);
	expect([...realms].sort()).toEqual(['client', 'server']);
});
