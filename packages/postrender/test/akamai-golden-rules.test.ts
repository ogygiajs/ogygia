import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AkamaiEdge } from '../src/adapters/akamai.ts';
import { CloudFrontEdge } from '../src/adapters/cloudfront.ts';
import { postrender } from '../src/index.ts';
import { akamai_prefix_tag, akamai_tag, akamai_url_tag } from '../src/key.ts';
import { invalidate_tags, install, mark_handled, reset_for_tests } from '../src/registry.ts';
import server, { type PostrenderServerOptions } from '../src/server.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { flag } from '../../flags/src/index.ts';
import flagsServer from '../../flags/src/server.ts';
import { MemoryStore } from '../src/memory-store.ts';

const AKAMAI_TAG_RE = /^[A-Za-z0-9!#$%'+./^_`|~-]{1,128}$/;
const heroFlag = flag('akamai-tag-hero', { control: 100 });

function make_akamai(overrides: Partial<ConstructorParameters<typeof AkamaiEdge>[0]> = {}) {
	return new AkamaiEdge({
		host: 'akab-test.purge.akamaiapis.net',
		clientToken: 'ct',
		clientSecret: 'cs',
		accessToken: 'at',
		site: 'https://www.example.com',
		...overrides
	});
}

describe('AkamaiEdge Golden Rules compliance', () => {
	const captured: { url: string; init: RequestInit }[] = [];
	beforeEach(() => {
		captured.length = 0;
		vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
			captured.push({ url: String(url), init: init ?? {} });
			return new Response(
				JSON.stringify({
					httpStatus: 201,
					purgeId: 'p-123',
					supportId: 's-456',
					detail: 'Request accepted'
				}),
				{ status: 201 }
			);
		});
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		reset_for_tests();
	});

	it('emits Akamai-legal Edge-Cache-Tag values (no colons, <=128 chars, <=128 tags) and merges app tags', () => {
		const edge = make_akamai();
		const headers = edge.headers({
			url: '/fr/fr/solar/',
			ttl: 3600,
			tags: ['cms-page-123', 'market-fr', 'invalid:colon']
		});
		const tags = (headers['edge-cache-tag'] ?? '')
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		expect(tags.length).toBeGreaterThan(0);
		expect(tags.length).toBeLessThanOrEqual(128);
		for (const t of tags) {
			expect(t).toMatch(AKAMAI_TAG_RE);
		}
		expect(tags).toContain('cms-page-123');
		expect(tags).toContain('market-fr');
		expect(tags).toContain('og_p/fr');
		expect(tags).toContain('og_p/fr/fr');
		expect(tags).toContain('og_p/fr/fr/solar');
	});

	it('defaults to Fast Purge DELETE for URL, prefix tag, and purgeTags', async () => {
		const audits: unknown[] = [];
		const edge = make_akamai({ onPurge: (entry) => audits.push(entry) });

		await edge.purgeUrl('/fr/fr/solar/');
		expect(captured[0].url).toContain('/ccu/v3/delete/url/production');

		await edge.purgeWhere({ prefix: '/fr/fr/' });
		expect(captured[1].url).toContain('/ccu/v3/delete/tag/production');
		expect(JSON.parse(String(captured[1].init.body))).toEqual({ objects: ['og_p/fr/fr'] });

		await edge.purgeTags(['cms-page-1', 's:file#fn:abc']);
		expect(captured[2].url).toContain('/ccu/v3/delete/tag/production');
		const sent = JSON.parse(String(captured[2].init.body)) as { objects: string[] };
		for (const t of sent.objects) expect(t).toMatch(AKAMAI_TAG_RE);

		expect(audits).toHaveLength(3);
		expect(audits[0]).toMatchObject({
			method: 'delete',
			selector: 'url',
			httpStatus: 201,
			purgeId: 'p-123',
			supportId: 's-456'
		});
	});

	it('invalidate_tags uses purgeTags once instead of N purgeUrl calls', async () => {
		const edge = make_akamai();
		const store = new MemoryStore();
		const runtime = install({ store, edge: [edge] });
		await store.put(
			'/a',
			{ kind: 'page', html: '<p>a</p>', headers: {}, created: Date.now() },
			{ ttl: 60, tags: ['s:src:1'] }
		);
		await store.put(
			'/b',
			{ kind: 'page', html: '<p>b</p>', headers: {}, created: Date.now() },
			{ ttl: 60, tags: ['s:src:1'] }
		);

		await invalidate_tags(['s:src:1'], runtime);
		expect(captured).toHaveLength(1);
		expect(captured[0].url).toContain('/ccu/v3/delete/tag/production');
	});

	it('preserves SvelteKit load edge-cache-tag and cache-tag headers during postrender capture', async () => {
		const options: PostrenderServerOptions = { ttl: 60, default: true };
		const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
		const edge = make_akamai();
		const runtime = install({ store: new MemoryStore(), edge: [edge] });
		const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };
		const c = ctx(new Request('http://x.test/fr/fr/about-us/'), { cookies: jar as never });
		mark_handled(c.event, runtime);
		const res = new Response('<html><head></head><body>hi</body></html>', {
			headers: {
				'content-type': 'text/html',
				'edge-cache-tag': 'cms-page-42, market-fr',
				'cache-tag': 'site_cms_top20'
			}
		});
		await server.page?.(c);
		const out = (await server.response?.(c, res)) ?? res;
		await server.done?.(c);
		const tagHeader = out.headers.get('edge-cache-tag') ?? '';
		expect(tagHeader).toContain('cms-page-42');
		expect(tagHeader).toContain('market-fr');
		expect(tagHeader).toContain('site_cms_top20');
		expect(tagHeader).toContain('og_p/fr/fr');
	});

	it('refuses edge caching for variants when variants.header is omitted, and purges variant URLs by tag when set', async () => {
		const plain = make_akamai();
		expect(plain.headers({ url: '/', ttl: 60, variants: [['hero', 'bold']] })).toEqual({
			'cache-control': 'private, no-store'
		});
		await plain.purgeWhere({ prefix: '/' });
		expect(JSON.parse(String(captured[0].init.body))).toEqual({ objects: ['og_p'] });

		const keyed = make_akamai({
			variants: { header: 'x-og-variants' },
			onPurge: () => {}
		});
		await keyed.purgeUrl('/fr/fr/landing');
		expect(captured[1].url).toContain('/ccu/v3/delete/tag/production');
		await keyed.purgeTags(['p:/fr/fr', 'b:v1']);
		expect(captured[2].url).toContain('/ccu/v3/delete/tag/production');
	});

	it('handles hierarchical country, category, tier, dynamic ID, and asset cache-tags without loss', () => {
		const edge = make_akamai({ variants: { header: 'x-og-variants' } });
		const hierarchical_tags = [
			'site_fr',
			'site_catalog',
			'site_catalog_fr',
			'site_catalog_top20',
			'site_prng',
			'site_prng_fr',
			'site_prng_top20',
			'site_cms',
			'site_cms_fr',
			'site_cms_top20',
			'site_cms_work_sol',
			'site_cms_work_sol_fr',
			'site_cms_work_sol_top20',
			'dapi_prng_9001',
			'dapi_prng_9001_fr',
			'dapi_prod_42_fr',
			'dapi_ddp_main_fr',
			'all_locator_acc88',
			'site_locator_99401',
			'site_assets',
			'site_search_assets',
			'site_loc_sitemap',
			'site_cfg_front',
			'site_fr'
		];
		const headers = edge.headers({
			url: '/region-south/fr/work/solutions/grid/',
			ttl: 604_800,
			tags: hierarchical_tags,
			variants: [['layout', 'v2']]
		});
		expect(headers['cache-control']).toBe('public, s-maxage=604800');
		const emitted = (headers['edge-cache-tag'] ?? '').split(',').map((t) => t.trim());
		for (const t of emitted) expect(t).toMatch(AKAMAI_TAG_RE);
		expect(new Set(emitted).size).toBe(emitted.length);
		for (const expected of new Set(hierarchical_tags)) {
			expect(emitted).toContain(expected);
		}
		expect(emitted).toContain('og_p/region-south');
		expect(emitted).toContain('og_p/region-south/fr');
		expect(emitted).toContain('og_p/region-south/fr/work');
		expect(emitted).toContain('og_flag_layout');
		expect(emitted).toContain('og_exp_layout_v2');
	});

	it('trims leading/trailing whitespace config artifacts on tags instead of turning spaces into underscores', async () => {
		expect(akamai_tag('   ')).toBe('');
		const edge = make_akamai({ maxAge: 1800, network: 'staging', method: 'invalidate' });
		const headers = edge.headers({
			url: '/fr/fr/locate/',
			ttl: 86_400,
			tags: [
				'all_locator',
				' site_locator_fr_fr',
				'  all_locator_fr_fr  ',
				'site_locator_fr_fr',
				'og_p/fr',
				'   '
			]
		});
		expect(headers['cache-control']).toBe('public, s-maxage=1800');
		const emitted = (headers['edge-cache-tag'] ?? '').split(',').map((t) => t.trim());
		expect(emitted).toContain('site_locator_fr_fr');
		expect(emitted).toContain('all_locator_fr_fr');
		expect(emitted).not.toContain('_site_locator_fr_fr');
		expect(emitted).not.toContain('___');
		expect(emitted.filter((t) => t === 'site_locator_fr_fr')).toHaveLength(1);
		expect(emitted.filter((t) => t === 'og_p/fr')).toHaveLength(1);

		await edge.purgeTags([' site_locator_fr_fr', '   ']);
		expect(captured).toHaveLength(1);
		expect(captured[0].url).toContain('/ccu/v3/invalidate/tag/staging');
		expect(JSON.parse(String(captured[0].init.body))).toEqual({
			objects: ['site_locator_fr_fr']
		});

		const audits: unknown[] = [];
		const audited = make_akamai({
			baseUrl: 'https://emu.akamai.test/',
			onPurge: (a) => audits.push(a)
		});
		vi.stubGlobal('fetch', async () => new Response('', { status: 201 }));
		await audited.purgeUrl('/fr/fr/locate/');
		expect(audits).toHaveLength(1);
		vi.stubGlobal('fetch', async () => new Response('not-json', { status: 201 }));
		await audited.purgeUrl('/fr/fr/locate/');
		expect(audits).toHaveLength(2);
		vi.stubGlobal(
			'fetch',
			async () =>
				({
					ok: false,
					status: 503,
					text: () => Promise.reject(new Error('stream broke'))
				}) as unknown as Response
		);
		await expect(audited.purgeUrl('/fr/fr/locate/')).rejects.toThrow(/akamai purge failed: 503/);
	});

	it('reserves structural prefix, URL, and variant tags when app tags exceed the 128-tag Akamai cap', async () => {
		const edge = make_akamai({ variants: { header: 'x-og-variants' } });
		const many_app_tags = Array.from({ length: 150 }, (_, i) => `site_cat_${i}_fr`);
		const url = '/fr/fr/product-range/item';
		const headers = edge.headers({
			url,
			ttl: 604_800,
			tags: many_app_tags,
			variants: [['cta', 'green']]
		});
		const emitted = (headers['edge-cache-tag'] ?? '').split(',').map((t) => t.trim());
		expect(emitted).toHaveLength(128);
		expect(emitted).toContain(akamai_prefix_tag('/fr'));
		expect(emitted).toContain(akamai_prefix_tag('/fr/fr'));
		expect(emitted).toContain(akamai_prefix_tag('/fr/fr/product-range'));
		expect(emitted).toContain(akamai_url_tag(url));
		expect(emitted).toContain('og_flag_cta');
		expect(emitted).toContain('og_exp_cta_green');

		await edge.purgeTags(many_app_tags);
		expect(captured).toHaveLength(2);
		const first_batch = JSON.parse(String(captured[0].init.body)) as { objects: string[] };
		const second_batch = JSON.parse(String(captured[1].init.body)) as { objects: string[] };
		expect(first_batch.objects).toHaveLength(128);
		expect(second_batch.objects).toHaveLength(22);
	});

	it('honors offload TTL tiers (10m to 365d), ttl=0 no-store, query exclusions, and authenticated session bypass', async () => {
		const edge = make_akamai();
		for (const ttl of [600, 3600, 21_600, 43_200, 86_400, 604_800, 2_592_000, 31_536_000]) {
			expect(edge.headers({ url: '/fr/fr/home/', ttl })['cache-control']).toBe(
				`public, s-maxage=${ttl}`
			);
		}
		expect(edge.headers({ url: '/_server/health', ttl: 0 })['cache-control']).toBeUndefined();

		const options: PostrenderServerOptions = { ttl: 604_800, default: true };
		const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
		const store = new MemoryStore();
		const runtime = install({ store, edge: [edge] });
		const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };

		for (const raw_url of [
			'http://x.test/fr/fr/search/?submit=monitoring',
			'http://x.test/fr/fr/product/?ts=1700000',
			'http://x.test/fr/fr/home/?aka-cache=no'
		]) {
			const c = ctx(new Request(raw_url), { cookies: jar as never });
			mark_handled(c.event, runtime);
			await server.page?.(c);
			const res = new Response('<html><head></head><body>q</body></html>', {
				headers: { 'content-type': 'text/html' }
			});
			await server.response?.(c, res);
			await server.done?.(c);
		}
		expect(await store.size()).toBe(0);

		const authed = ctx(
			new Request('http://x.test/fr/fr/dashboard/', {
				headers: {
					'sec-fetch-mode': 'navigate',
					cookie: 'app.session=1; auth.session-token=tok123'
				}
			}),
			{ cookies: jar as never }
		);
		mark_handled(authed.event, runtime);
		await server.page?.(authed);
		const authed_res = new Response('<html><head></head><body>me</body></html>', {
			headers: { 'content-type': 'text/html' }
		});
		const authed_out = (await server.response?.(authed, authed_res)) ?? authed_res;
		await server.done?.(authed);
		expect(authed_out.headers.get('cache-control')).toContain('no-store');
		expect(await store.get('/fr/fr/dashboard/')).toBeNull();
	});

	it('postrender.invalidateTags isolates prod vs preprod namespaces and fans out to tag and URL edges', async () => {
		const options: PostrenderServerOptions = { ttl: 3600, default: true };
		const flagsHarness = startPlugin(flagsServer, { name: '@ogygia/flags' });
		const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
		const akamai = make_akamai({ variants: { header: 'x-og-variants' } });
		const cloudfront = new CloudFrontEdge({
			distributionId: 'EDIST1',
			accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
			secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
			baseUrl: 'https://cf.example.test'
		});
		const store = new MemoryStore();
		const runtime = install({ store, edge: [akamai, cloudfront] });
		const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };

		const render_and_capture = async (url: string, tag_header: string, read_variant = false) => {
			const request = new Request(`http://x.test${url}`);
			const fCtx = flagsHarness.ctx(request, { cookies: jar as never });
			await flagsServer.request?.(fCtx);
			const c = ctx(request, { cookies: jar as never });
			mark_handled(c.event, runtime);
			await server.page?.(c);
			if (read_variant) heroFlag(c.event);
			const res = new Response(`<html><head></head><body>${url}</body></html>`, {
				headers: { 'content-type': 'text/html', 'edge-cache-tag': tag_header }
			});
			await server.response?.(c, res);
			await server.done?.(c);
			await flagsServer.done?.(fCtx);
		};

		await render_and_capture('/fr/fr/about-us/', 'pre_fr, pre_cms, pre_cms_fr, pre_cms_top20');
		await render_and_capture(
			'/fr/fr/work/campaign/',
			'pre_fr, pre_cms_work_campaign, pre_cms_fr',
			true
		);
		await render_and_capture('/fr/fr/brands/', 'site_fr, site_cms, site_cms_fr');

		await postrender.invalidateTags(['   ']);
		expect(captured).toHaveLength(0);

		await postrender.invalidateTags([' pre_cms_fr ']);
		expect(await store.get('/fr/fr/about-us/')).toBeNull();
		expect(await store.get('/fr/fr/work/campaign/\0v:akamai-tag-hero=control')).toBeNull();
		expect(await store.get('/fr/fr/brands/')).not.toBeNull();

		const akamai_calls = captured.filter((c) => c.url.includes('akamaiapis.net'));
		const cf_calls = captured.filter((c) => c.url.includes('cf.example.test'));
		expect(akamai_calls).toHaveLength(1);
		expect(JSON.parse(String(akamai_calls[0].init.body))).toEqual({ objects: ['pre_cms_fr'] });
		expect(cf_calls).toHaveLength(2);
		for (const call of cf_calls) {
			expect(String(call.init.body)).not.toContain('\0');
		}
	});
});
