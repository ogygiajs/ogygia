import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { flag, decide, flush_exposures, type ExposureEvent } from '../../flags/src/index.ts';
import flagsServer from '../../flags/src/server.ts';
import postrenderServer, { type PostrenderServerOptions } from '../src/server.ts';
import { install, mark_handled, reset_for_tests } from '../src/registry.ts';
import { MemoryStore } from '../src/memory-store.ts';
import { AkamaiEdge } from '../src/adapters/akamai.ts';

vi.mock('$app/env', () => ({ building: false, dev: false, version: 'test-v1' }));

const hero = flag('pr-hero', { control: 50, bold: 50 });
const subPromo = flag('pr-sub-promo', 50);

function visitorIn(
	f: (c: { request: Request; url: URL; visitor?: { vid?: string } }) => string,
	want: string
): string {
	for (let i = 0; i < 2000; i++) {
		const vid = `vid-${i}`;
		const request = new Request('http://x.test/');
		if (f({ request, url: new URL(request.url), visitor: { vid } }) === want) return vid;
	}
	throw new Error(`no visitor landed in ${want}`);
}

describe('postrender × @ogygia/flags (variant-keyed cache)', () => {
	const options: PostrenderServerOptions = { ttl: 60, default: true };
	const flagsHarness = startPlugin(flagsServer, { name: '@ogygia/flags' });
	const prHarness = startPlugin(postrenderServer, { name: '@ogygia/postrender', options });
	const exposures: ExposureEvent[] = [];

	beforeEach(() => {
		exposures.length = 0;
		decide({
			exposure: (batch) => {
				exposures.push(...batch);
			},
			batch: { max: 1, ms: 0 }
		});
	});

	afterEach(async () => {
		await flush_exposures();
		decide({ source: undefined, exposure: undefined });
		reset_for_tests();
	});

	it('caches each variant arm once per branch, serves hits without re-rendering, and emits accurate exposures', async () => {
		const runtime = install({ store: new MemoryStore() });
		const vidControl = visitorIn((c) => hero(c as never), 'control');
		const vidBold = visitorIn((c) => hero(c as never), 'bold');

		let renders = 0;
		const visit = async (vid?: string, extraHeaders?: Record<string, string>) => {
			const headers: Record<string, string> = { ...extraHeaders };
			if (vid) headers.cookie = `og-vid=${vid}`;
			const request = new Request('http://x.test/landing/', { headers });
			const jar = new Map<string, string>(vid ? [['og-vid', vid]] : []);
			const cookies = {
				get: (n: string) => jar.get(n),
				getAll: () => [...jar].map(([name, value]) => ({ name, value })),
				set: () => {},
				delete: () => {}
			};
			const fCtx = flagsHarness.ctx(request, { cookies: cookies as never });
			await flagsServer.request?.(fCtx);
			const pCtx = prHarness.ctx(request, { cookies: cookies as never });
			mark_handled(pCtx.event, runtime);
			const hit = await postrenderServer.page?.(pCtx);
			if (hit) {
				await postrenderServer.done?.(pCtx);
				await flagsServer.done?.(fCtx);
				return hit;
			}
			renders++;
			const h = hero(pCtx.event);
			// Chained flag: ONLY `bold` reads `subPromo`
			const sub = h === 'bold' ? (subPromo(pCtx.event) ? 'sub-on' : 'sub-off') : 'no-sub';
			const res = new Response(`<html><head></head><body>${h}:${sub}</body></html>`, {
				headers: { 'content-type': 'text/html' }
			});
			const out = (await postrenderServer.response?.(pCtx, res)) ?? res;
			await postrenderServer.done?.(pCtx);
			await flagsServer.done?.(fCtx);
			return out;
		};

		// 1. Control visitor: cold miss -> renders once, stores control arm
		const r1 = await visit(vidControl);
		expect(await r1.text()).toContain('control:no-sub');
		expect(r1.headers.get('cache-control')).toBe('private, no-store');
		expect(renders).toBe(1);

		// 2. Another control visit -> cache HIT, no re-render, and NO false subPromo exposure!
		exposures.length = 0;
		const r2 = await visit(vidControl);
		expect(await r2.text()).toContain('control:no-sub');
		expect(r2.headers.get('x-ogygia-postrender')).toBe('hit');
		expect(renders).toBe(1);
		await flush_exposures();
		expect(exposures.map((e) => e.name)).toEqual(['pr-hero']);
		expect(exposures[0].vid).toBe(vidControl);

		// 3. Bold visitor (with og-vid cookie only -> non-credentialed, so it stores!) -> cold miss -> renders bold arm
		const r3 = await visit(vidBold);
		const t3 = await r3.text();
		expect(t3).toMatch(/bold:sub-(on|off)/);
		expect(renders).toBe(2);

		// 4. Second bold visit -> cache HIT, no re-render, both exposures logged
		exposures.length = 0;
		const r4 = await visit(vidBold);
		const t4 = await r4.text();
		expect(t4).toContain('name="ogygia-stored"');
		expect(t4.replace('<meta name="ogygia-stored" content="hit">', '')).toBe(t3);
		expect(r4.headers.get('x-ogygia-postrender')).toBe('hit');
		expect(renders).toBe(2);
		await flush_exposures();
		expect(exposures.map((e) => e.name)).toEqual(['pr-hero', 'pr-sub-promo']);
	});

	it('keeps private, no-store on Akamai unless variants.header is configured, then emits public + experiment tags', async () => {
		const edgeKeyed = new AkamaiEdge({
			host: 'akab-test.purge.akamaiapis.net',
			clientToken: 'ct',
			clientSecret: 'cs',
			accessToken: 'at',
			site: 'https://www.example.com',
			variants: { header: 'x-og-variants' }
		} as never);
		const headers = edgeKeyed.headers({
			url: '/landing/',
			ttl: 300,
			variants: [['pr-hero', 'bold']]
		} as never);
		expect(headers['cache-control']).toBe('public, s-maxage=300');
		expect(headers['edge-cache-tag']).toContain('og_flag_pr-hero');
		expect(headers['edge-cache-tag']).toContain('og_exp_pr-hero_bold');
	});

	it('edge-keyed Akamai variant page mints etag/last-modified and treats non-og-vid cookies as credentialed', async () => {
		const edgeKeyed = new AkamaiEdge({
			host: 'akab-test.purge.akamaiapis.net',
			clientToken: 'ct',
			clientSecret: 'cs',
			accessToken: 'at',
			site: 'https://www.example.com',
			variants: { header: 'x-og-variants' }
		});
		const runtime = install({ store: new MemoryStore(), edge: [edgeKeyed] });
		const vidBold = visitorIn((c) => hero(c as never), 'bold');

		const req1 = new Request('http://x.test/edge-ab/', {
			headers: { cookie: `og-vid=${vidBold}` }
		});
		const jar1 = new Map([['og-vid', vidBold]]);
		const cookies1 = {
			get: (n: string) => jar1.get(n),
			getAll: () => [{ name: 'og-vid', value: vidBold }],
			set: () => {},
			delete: () => {}
		};
		const f1 = flagsHarness.ctx(req1, { cookies: cookies1 as never });
		await flagsServer.request?.(f1);
		const c1 = prHarness.ctx(req1, { cookies: cookies1 as never });
		mark_handled(c1.event, runtime);
		await postrenderServer.page?.(c1);
		hero(c1.event);
		const out1 =
			(await postrenderServer.response?.(
				c1,
				new Response('<html><head></head><body>bold</body></html>', {
					headers: { 'content-type': 'text/html' }
				})
			)) ?? new Response();
		await postrenderServer.done?.(c1);
		await flagsServer.done?.(f1);
		expect(out1.headers.get('cache-control')).toBe('public, s-maxage=60');
		expect(out1.headers.get('etag')).toBeTruthy();

		// Session cookie + og-vid is credentialed: never stores a new entry
		const reqAuth = new Request('http://x.test/auth-ab/', {
			headers: { cookie: `og-vid=${vidBold}; session=secret` }
		});
		const c2 = prHarness.ctx(reqAuth);
		mark_handled(c2.event, runtime);
		await postrenderServer.page?.(c2);
		expect(c2.state.credentials).toBe(true);
		await postrenderServer.done?.(c2);
	});
});
