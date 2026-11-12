// The profiler's route table: the guard in front of every route, the bare report page that shows
// server data only to a logged-in visitor, and the report files a request can GET by id or POST
// with the report in its body.
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '@ogygia/router';

const pages = vi.hoisted(() => [] as { component: unknown; def: { load?: (c: Ctx) => unknown } }[]);
vi.mock('@ogygia/router', async (importOriginal) => {
	const real = await importOriginal<typeof import('@ogygia/router')>();
	return {
		...real,
		page: ((component: unknown, def: { load?: (c: Ctx) => unknown }) => {
			pages.push({ component, def });
			return (real.page as (c: unknown, d: unknown) => unknown)(component, def);
		}) as typeof real.page
	};
});
for (const name of ['Dashboard', 'Report', 'Run', 'Login', 'Upload', 'Message', 'Compare', 'Site'])
	vi.doMock(`../src/profiler/ui/${name}.svelte`, () => ({ default: { name } }));

const { build_profiler_router } = await import('../src/profiler/profiler-router.ts');
type Deps = Parameters<typeof build_profiler_router>[0];

const BASE = '/_profiler';
const req = (path: string, init?: RequestInit) => new Request(`http://x${BASE}${path}`, init);

function deps(over: Partial<Deps> = {}): Deps {
	const no = () => {
		throw new Error('not in this test');
	};
	return {
		base: BASE,
		auth_guard: async () => undefined,
		beacon: async () => new Response('beacon'),
		window_start: async () => new Response('start'),
		window_stop: async () => new Response('stop'),
		authed: async () => false,
		dashboard: no,
		compare: no,
		site: no,
		replay: no,
		source: no,
		run_page: no,
		record_page: no,
		reset: no,
		status: () => ({ recording: false, inflight: 0, rss_mb: 1, reports: 0 }),
		login_props: no,
		login: no,
		logout: no,
		upload: no,
		report_stored: () => undefined,
		report_load: async () => undefined,
		list_stored: async () => [],
		login_url: () => `${BASE}/login`,
		report_view: no,
		report_json: () => new Response('json'),
		report_dump_json: () => new Response('dump'),
		report_html: async () => new Response('html'),
		report_posted: async (_c, as) => new Response(`posted ${as}`),
		report_raw: async () => new Response('raw'),
		...over
	} as Deps;
}

function report_load(d: Deps) {
	pages.length = 0;
	build_profiler_router(d);
	const found = pages.find((p) => (p.component as { name?: string }).name === 'Report');
	if (!found?.def.load) throw new Error('no report page');
	return (id: string) => found.def.load?.({ params: { id } } as unknown as Ctx);
}

describe('the profiler routes', () => {
	it('every route is behind the guard: a deny answers for the beacon and the recording window', async () => {
		const beacon = vi.fn(async () => new Response('beacon'));
		const window_start = vi.fn(async () => new Response('start'));
		const app = build_profiler_router(
			deps({ auth_guard: async () => new Response('no', { status: 401 }), beacon, window_start })
		);
		expect((await app.fetch(req('/beacon', { method: 'POST' })))?.status).toBe(401);
		expect((await app.fetch(req('/window/start', { method: 'POST' })))?.status).toBe(401);
		expect(beacon).not.toHaveBeenCalled();
		expect(window_start).not.toHaveBeenCalled();
		const open = build_profiler_router(deps({ beacon }));
		expect(await (await open.fetch(req('/beacon', { method: 'POST' })))?.text()).toBe('beacon');
	});

	it('the bare report page gives server data only to a logged-in visitor', async () => {
		const stored = { id: 'r1' } as never;
		const view = { a: 1 } as never;
		const report_view = vi.fn(async () => view);
		const report_load_fn = vi.fn(async () => stored);
		const authed = report_load(
			deps({ authed: async () => true, report_load: report_load_fn, report_view })
		);
		expect(await authed('r1')).toEqual({ report: view, base: BASE, login: null, exists: true });
		expect(report_load_fn).toHaveBeenCalledWith('r1');

		const guest = report_load(
			deps({ report_stored: () => stored, report_load: report_load_fn, report_view })
		);
		report_load_fn.mockClear();
		report_view.mockClear();
		// the server has it: say so and offer the login (most likely its owner on a fresh browser)
		expect(await guest('r1')).toEqual({
			report: null,
			base: BASE,
			login: `${BASE}/login`,
			exists: true
		});
		expect(report_view).not.toHaveBeenCalled();
		// a guest never reaches the storage backend by guessing ids
		expect(report_load_fn).not.toHaveBeenCalled();

		const none = report_load(deps());
		expect(await none('gone')).toEqual({
			report: null,
			base: BASE,
			login: `${BASE}/login`,
			exists: false
		});
	});

	it('a report file is GET by id from the store, or POST with the report in the body on any instance', async () => {
		const stored = { id: 'r1' } as never;
		const app = build_profiler_router(deps({ report_load: async () => stored }));
		for (const [path, body] of [
			['/report/r1.json', 'json'],
			['/report/r1.html', 'html'],
			['/report/r1.dump', 'dump'],
			['/report/r1/raw', 'raw']
		])
			expect(await (await app.fetch(req(path)))?.text()).toBe(body);
		for (const as of ['json', 'html', 'dump', 'ogp'])
			expect(await (await app.fetch(req(`/report/r1.${as}`, { method: 'POST' })))?.text()).toBe(
				`posted ${as}`
			);
	});

	it('a report the store no longer holds is a thrown 404', async () => {
		const app = build_profiler_router(deps());
		const thrown = await app.fetch(req('/report/gone.json')).then(
			(r) => r?.status,
			(e: unknown) => (e as { status?: number }).status
		);
		expect(thrown).toBe(404);
	});
});

// A link on another site makes a plain GET, and a SameSite=Lax session cookie rides along: no GET
// may change the profiler's state (#1168). Each route changes it only on a POST.
describe('the profiler routes that change state', () => {
	const changes: [string, keyof Deps][] = [
		['/reset', 'reset'],
		['/page?p=/x&runs=50', 'record_page'],
		['/replay/r1', 'replay'],
		['/logout', 'logout']
	];
	for (const [path, dep] of changes) {
		it(`${path.split('?')[0]}: a GET changes nothing, a POST does`, async () => {
			const done = vi.fn(async () => new Response('done'));
			const app = build_profiler_router(deps({ [dep]: done } as Partial<Deps>));
			const got = await app.fetch(req(path)).then(
				(r) => r?.status,
				(e: unknown) => (e as { status?: number }).status
			);
			expect(done).not.toHaveBeenCalled();
			expect(got).not.toBe(200);
			expect(await (await app.fetch(req(path, { method: 'POST' })))?.text()).toBe('done');
			expect(done).toHaveBeenCalledTimes(1);
		});
	}
});
