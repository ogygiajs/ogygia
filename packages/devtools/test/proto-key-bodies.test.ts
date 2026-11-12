// A body from the browser with a `__proto__` key (JSON.parse keeps it as an own key) is refused or
// read as plain data by every profiler endpoint that parses one: the beacon, a report carried with
// the request, and the unlock. Nothing reaches Object.prototype, nothing answers 500, and the
// endpoint still works for the next well-formed body.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';

// (dev opens the profiler to anyone: the unlock is checked as a production build runs it)
const dev_switch = vi.hoisted(() => ({ dev: true }));
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));

const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype).sort();
// (a production profiler opens only on a secret of 16 bytes or more)
const SECRET = 'prof-key-0123456789';
const POLLUTION = `{"og_polluted":"yes","page":"/evil","key":"${SECRET}","islands":[]}`;

/** `value` as JSON text with `extra` as the first key of every object (`"__proto__":…` or
 *  `"constructor":{"prototype":…}`), at every depth. */
function hostile(value: unknown, extra: string): string {
	if (Array.isArray(value)) return `[${value.map((v) => hostile(v, extra)).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const own = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${hostile(v, extra)}`);
		return `{${[extra, ...own].join(',')}}`;
	}
	return JSON.stringify(value);
}
const EXTRAS = [
	`"__proto__":${POLLUTION}`,
	`"constructor":{"prototype":${POLLUTION}}`,
	`"__proto__":{"__proto__":${POLLUTION}}`
];

afterEach(() => {
	expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTO_NAMES);
	expect(({} as Record<string, unknown>).og_polluted).toBeUndefined();
	expect(([] as unknown as Record<string, unknown>).og_polluted).toBeUndefined();
});

function make_event(path: string, init?: RequestInit): RequestEvent {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		request: new Request(url, init),
		route: { id: path.startsWith('/__profiler') ? null : '/[slug]' },
		cookies: {
			get: () => undefined,
			set: () => {},
			delete: () => {},
			getAll: () => [],
			serialize: () => ''
		},
		fetch: async () => new Response('ok')
	} as unknown as RequestEvent;
}

const KEY = { 'x-profiler-key': SECRET };

describe('the beacon', () => {
	const bodies: unknown[] = [
		{ page: '/p', vitals: { ttfb: 100, lcp: 900, cls: 0.05 } },
		{ page: '/p', islands: [{ fp: 'aaaaaaaaaaaaaaaa', entry: '/x.js', ms: 12, load: 3 }] },
		{ page: '/p', marks: [{ name: 'm', ms: 3, attrs: { n: 1 } }] },
		{
			page: '/p',
			visit: {
				at: 1,
				nav: { res_start: 120, phases: { dns: 1 } },
				paints: { fcp: 400, lcp: 900 },
				resources: [{ url: 'https://a.test/x.js', type: 'script', start: 1, end: 2 }],
				longtasks: [],
				islands: [{ fp: 'aaaaaaaaaaaaaaaa', t0: 0, loaded: 5, turn: 6, done: 9 }],
				firsts: [],
				shifts: [],
				vitals: { lcp: 900 }
			}
		},
		{
			page: '/p',
			cpu: {
				resources: [{ id: 0, url: 'https://a.test/x.js' }],
				frames: [{ name: 'Card', resourceId: 0, line: 1, column: 1 }],
				stacks: [{ frameId: 0 }],
				samples: [{ timestamp: 0, stackId: 0 }]
			}
		}
	];

	it('takes a `__proto__` or `constructor` key at any depth as plain data, or refuses it', async () => {
		const handle = profiler({ secret: SECRET });
		const post = (body: string) =>
			handle({
				event: make_event('/__profiler/beacon', { method: 'POST', body }),
				resolve: async () => new Response('no')
			});
		for (const body of bodies)
			for (const extra of EXTRAS) {
				const res = await post(hostile(body, extra));
				expect(res.status, hostile(body, extra)).toBeLessThan(500);
			}
		// and the next well-formed post still lands
		expect((await post(JSON.stringify(bodies[0]))).status).toBe(204);
	});
});

describe('a report carried with the request', () => {
	it('a dump with a `__proto__` or `constructor` key at any depth is opened as data, or refused', async () => {
		const made = profiler({ secret: SECRET });
		const rec = await made({
			event: make_event('/__profiler/page?p=/p&runs=1&cold=0', { headers: KEY }),
			resolve: async () => new Response('<html></html>')
		});
		const id = rec.headers.get('location')!.split('/').pop()!;
		const dump: unknown = await (
			await made({
				event: make_event(`/__profiler/report/${id}.dump`, { headers: KEY }),
				resolve: async () => new Response('no')
			})
		).json();
		for (const extra of EXTRAS) {
			// another instance each time: it never saw the report, so it opens the one carried
			const other = profiler({ secret: SECRET });
			for (const [headers, body] of [
				[{ 'content-type': 'application/json' }, hostile(dump, extra)],
				[
					{ 'content-type': 'application/json', 'x-og-encoding': 'gzip' },
					gzipSync(hostile(dump, extra))
				]
			] as const) {
				const res = await other({
					event: make_event(`/__profiler/report/${id}.json`, {
						method: 'POST',
						headers: { ...KEY, ...headers },
						body: body as BodyInit
					}),
					resolve: async () => new Response('no')
				});
				expect(res.status).toBeLessThan(500);
				await res.text();
			}
		}
	});
});

describe('the unlock', () => {
	it('a key under `__proto__` is no key', async () => {
		dev_switch.dev = false;
		try {
			const handle = profiler({ secret: SECRET });
			const unlock = (body: string) =>
				handle({
					event: make_event('/__profiler/login', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body
					}),
					resolve: async () => new Response('no')
				});
			for (const extra of EXTRAS)
				expect((await unlock(hostile({ next: '/__profiler' }, extra))).status).toBe(401);
			// (the right key, said plainly, still unlocks)
			expect((await unlock(JSON.stringify({ key: SECRET }))).status).toBe(200);
		} finally {
			dev_switch.dev = true;
		}
	});
});
