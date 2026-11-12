/**
 * `span` and `span.start` under the real profiler host: what a recorded span carries (its caller,
 * its parent).
 */
import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';
import { instrument, span } from '../src/profiler/span.ts';

const dev_switch = vi.hoisted(() => ({ dev: true }));
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));

function make_event(path: string, headers: Record<string, string> = {}): RequestEvent {
	const url = new URL('http://localhost' + path);
	return {
		url,
		request: new Request(url, { headers }),
		route: { id: '/[slug]' },
		cookies: {
			get: () => undefined,
			set: () => {},
			delete: () => {},
			getAll: () => [],
			serialize: () => ''
		},
		fetch: async () => new Response('<html><body>ok</body></html>')
	} as unknown as RequestEvent;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = { name: string; callers: string[]; self_ms: number; total_ms: number };

/** Profiles one request whose page runs `body`, and returns the report's span rows. */
async function profile_spans(body: () => Promise<void>): Promise<Row[]> {
	const handle = profiler({ secret: 'prof-key' });
	const res = await handle({
		event: make_event('/p', { 'x-profile': 'prof-key' }),
		resolve: async () => {
			await body();
			return new Response('page');
		}
	});
	const url = res.headers.get('x-profile-report')!;
	const json = await (
		await handle({
			event: make_event(url + '.json', { 'x-profiler-key': 'prof-key' }),
			resolve: async () => new Response('no')
		})
	).json();
	return json.spans;
}

describe('span under the profiler host', () => {
	it('a span opened by hand while a span runs is its child: the parent keeps only its own time', async () => {
		const rows = await profile_spans(async () => {
			await span('outer', async () => {
				const h = span.start('by-hand');
				await wait(30);
				h.end();
				await wait(5);
			});
		});
		const outer = rows.find((r) => r.name === 'outer')!;
		expect(rows.find((r) => r.name === 'by-hand')).toBeTruthy();
		expect(outer.self_ms).toBeLessThan(outer.total_ms - 20);
	}, 30_000);

	it("a span's caller is the app line that called span(), not the profiler's own file", async () => {
		const rows = await profile_spans(async () => {
			await span('db.user', () => wait(5));
		});
		const row = rows.find((r) => r.name === 'db.user')!;
		expect(row.callers.join(' ')).toContain('profiler-span.test.ts');
		expect(row.callers.join(' ')).not.toContain('span.ts:');
	}, 30_000);
});

describe('instrument without a recording', () => {
	it('an instrumented method keeps its `this`', () => {
		const obj = {
			n: 3,
			count: instrument(function (this: { n: number }, k: number) {
				return this.n * k;
			}, 'obj.count')
		};
		expect(obj.count(2)).toBe(6);
	});
});
