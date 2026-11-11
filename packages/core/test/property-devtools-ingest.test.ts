// The devtools stream's server events arrive as JSON in the page (`application/ogygia-devtools`,
// events/sinks.ts) and go through `ingest` (events/bus.ts). Over generated JSON: only well-formed
// server events enter the stream (an object with the envelope: v, seq, t numbers, realm 'server', a
// known domain and a name), so a reader of the stream (the dock, a trace, a sink) never meets null, a
// number, or an event that claims the client realm.
import { beforeEach, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';

(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
const { ingest, snapshot, clear, configure } = await import('../src/events/bus.ts');

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

it('only well-formed server events enter the stream, whatever the side channel holds', () => {
	let kept = 0;
	fc.assert(
		fc.property(
			fc.array(fc.oneof(event_like, fc.jsonValue({ maxDepth: 2 })), { maxLength: 8 }),
			(raw) => {
				clear();
				// as the page carries it: JSON text read back
				ingest(JSON.parse(JSON.stringify(raw)));
				for (const e of snapshot()) {
					kept++;
					expect(e !== null && typeof e === 'object' && !Array.isArray(e)).toBe(true);
					expect(e.realm).toBe('server');
					expect(DOMAINS).toContain(e.domain);
					expect(typeof e.name).toBe('string');
					for (const k of ['v', 'seq', 't'] as const) expect(Number.isFinite(e[k]), k).toBe(true);
				}
			}
		),
		{ numRuns: 300 }
	);
	expect(kept, 'some generated events were well formed').toBeGreaterThan(10);
});
