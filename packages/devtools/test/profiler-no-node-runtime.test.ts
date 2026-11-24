// The profiler on a runtime without Node's process and inspector APIs (#2156): `process.cpuUsage`
// throws "not implemented" and `node:inspector` cannot be imported. A page request still answers,
// logged without CPU time; a header-profiled request is answered unprofiled; the gap is said once,
// with its code.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { ProfilerHandle as Handle } from '../src/profiler/index.ts';

const dev_switch = vi.hoisted(() => ({ dev: false }));
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));
const host = vi.hoisted(() => ({ cpu: false, inspector: false, loop_delay: true }));
vi.mock('node:inspector/promises', async (real) => {
	if (!host.inspector) throw new Error('No such module "node:inspector/promises"');
	return real();
});
vi.mock('node:perf_hooks', async (real) => {
	const actual = await real<typeof import('node:perf_hooks')>();
	return {
		...actual,
		monitorEventLoopDelay: (o?: { resolution?: number }) => {
			if (!host.loop_delay) throw new Error('perf_hooks.monitorEventLoopDelay is not implemented');
			return actual.monitorEventLoopDelay(o);
		}
	};
});

vi.setConfig({ testTimeout: 30_000 });

const SECRET = 'prof-key-of-16-bytes-or-more';
const CODE = 'devtools_profiler_runtime_unsupported';

const event = (path: string, headers: Record<string, string> = {}): RequestEvent => {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		request: new Request(url, { headers: { accept: 'text/html', ...headers } }),
		route: { id: '/[slug]' },
		cookies: {
			get: () => undefined,
			set: () => {},
			delete: () => {},
			getAll: () => [],
			serialize: () => ''
		},
		fetch: async () => new Response('ok')
	} as unknown as RequestEvent;
};

const page = () =>
	new Response('<html><head></head><body>hi</body></html>', {
		headers: { 'content-type': 'text/html' }
	});

let said: string[] = [];
beforeEach(() => {
	vi.resetModules();
	said = [];
	const cpu = process.cpuUsage.bind(process);
	vi.spyOn(process, 'cpuUsage').mockImplementation((since?: NodeJS.CpuUsage) => {
		if (!host.cpu) throw new Error('The process.cpuUsage method is not implemented');
		return cpu(since);
	});
	const keep = (...a: unknown[]) => void said.push(a.map(String).join(' '));
	vi.spyOn(console, 'warn').mockImplementation(keep);
	vi.spyOn(console, 'error').mockImplementation(keep);
});
afterEach(() => {
	vi.restoreAllMocks();
	dev_switch.dev = false;
	Object.assign(host, { cpu: false, inspector: false, loop_delay: true });
});

const record_page = async (handle: Handle) => {
	const ev = event('/__profiler/page?p=/p&runs=1&cold=0', { 'x-profiler-key': SECRET });
	Object.assign(ev, {
		request: new Request(ev.url, { method: 'POST', headers: ev.request.headers })
	});
	return handle({ event: ev, resolve: async () => page() });
};

it('without node:inspector, a page recording is refused with the code, and pages still answer', async () => {
	host.cpu = true;
	const { profiler } = await import('../src/profiler/index.ts');
	const handle = profiler({ secret: SECRET });
	const res = await record_page(handle);
	expect(res.status).toBe(501);
	expect(await res.text()).toContain(CODE);
	expect((await handle({ event: event('/e'), resolve: async () => page() })).status).toBe(200);
});

it('without perf_hooks.monitorEventLoopDelay, a header-profiled request is answered unprofiled', async () => {
	Object.assign(host, { cpu: true, inspector: true, loop_delay: false });
	const { profiler } = await import('../src/profiler/index.ts');
	const handle = profiler({ secret: SECRET });
	const res = await handle({
		event: event('/f', { 'x-profile': SECRET }),
		resolve: async () => page()
	});
	expect(res.status).toBe(200);
	expect(res.headers.get('x-profile-report')).toBeNull();
	expect(said.some((s) => s.includes(CODE))).toBe(true);
});

it('without process.cpuUsage, a page request answers 200 and is still logged', async () => {
	const { profiler } = await import('../src/profiler/index.ts');
	const handle = profiler({ secret: SECRET });
	const res = await handle({ event: event('/a-page'), resolve: async () => page() });
	expect(res.status).toBe(200);
	expect(await res.text()).toContain('hi');
	const dash = await handle({
		event: event('/__profiler', { 'x-profiler-key': SECRET }),
		resolve: async () => new Response('fell through', { status: 404 })
	});
	expect(dash.status).toBe(200);
	expect(await dash.text()).toContain('/a-page');
});

it('without process.cpuUsage, dev Server-Timing keeps the render time and leaves CPU out', async () => {
	dev_switch.dev = true;
	const { profiler } = await import('../src/profiler/index.ts');
	const handle = profiler({});
	const res = await handle({ event: event('/b'), resolve: async () => page() });
	expect(res.status).toBe(200);
	const timing = res.headers.get('server-timing') ?? '';
	expect(timing).toContain('ssr;');
	expect(timing).not.toContain('cpu;');
});

it('without node:inspector, a header-profiled request is answered unprofiled', async () => {
	const { profiler } = await import('../src/profiler/index.ts');
	const handle = profiler({ secret: SECRET });
	const res = await handle({
		event: event('/c', { 'x-profile': SECRET }),
		resolve: async () => page()
	});
	expect(res.status).toBe(200);
	expect(res.headers.get('x-profile-report')).toBeNull();
});

it('the runtime gap is said once, with its code, however many requests come', async () => {
	const { profiler } = await import('../src/profiler/index.ts');
	const handle = profiler({ secret: SECRET });
	for (const p of ['/d1', '/d2', '/d3'])
		await handle({ event: event(p, { 'x-profile': SECRET }), resolve: async () => page() });
	const coded = said.filter((s) => s.includes(CODE));
	expect(coded.length).toBeGreaterThan(0);
	expect(new Set(coded).size).toBe(coded.length);
	expect(said.join('\n')).not.toContain('not implemented');
});
