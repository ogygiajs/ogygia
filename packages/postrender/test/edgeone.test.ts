import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	EDGEONE_MAX_TARGETS,
	EdgeOneEdge,
	type EdgeOnePurgeAudit
} from '../src/adapters/edgeone.ts';
import { akamai_prefix_tag, akamai_url_tag } from '../src/key.ts';
import { start_edge_emulator, type EdgeEmulator } from '../e2e/emulator.ts';
import http from 'node:http';

function make_edgeone(overrides: Partial<ConstructorParameters<typeof EdgeOneEdge>[0]> = {}) {
	return new EdgeOneEdge({
		zoneId: 'zone-2abc999',
		secretId: 'AKIDexample123',
		secretKey: 'SKexample456',
		site: 'https://www.example.cn/',
		...overrides
	});
}

describe('EdgeOneEdge (Tencent Cloud EdgeOne)', () => {
	const captured: { url: string; init: RequestInit }[] = [];

	beforeEach(() => {
		captured.length = 0;
		vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
			captured.push({ url: String(url), init: init ?? {} });
			return new Response(
				JSON.stringify({
					Response: {
						JobId: 'job-eo-1',
						FailedList: [],
						RequestId: 'req-eo-1'
					}
				}),
				{ status: 200 }
			);
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('signs CreatePurgeTask with TC3-HMAC-SHA256 and calls teo.tencentcloudapi.com', async () => {
		const audits: EdgeOnePurgeAudit[] = [];
		const edge = make_edgeone({ onPurge: (a) => audits.push(a) });
		expect(edge.name).toBe('edgeone');

		await edge.purgeUrl('/zh/careers/search/');
		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe('https://teo.tencentcloudapi.com/');

		const headers = captured[0].init.headers as Record<string, string>;
		expect(headers['content-type']).toBe('application/json; charset=utf-8');
		expect(headers.host).toBe('teo.tencentcloudapi.com');
		expect(headers['x-tc-action']).toBe('CreatePurgeTask');
		expect(headers['x-tc-version']).toBe('2022-09-01');

		const timestamp = headers['x-tc-timestamp'];
		const d = new Date(Number(timestamp) * 1000);
		const pad = (n: number) => String(n).padStart(2, '0');
		const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
		const payload = String(captured[0].init.body);
		const payload_hash = createHash('sha256').update(payload).digest('hex');
		const canonical = [
			'POST',
			'/',
			'',
			'content-type:application/json; charset=utf-8',
			'host:teo.tencentcloudapi.com',
			'x-tc-action:createpurgetask',
			'',
			'content-type;host;x-tc-action',
			payload_hash
		].join('\n');
		const scope = `${date}/teo/tc3_request`;
		const string_to_sign = [
			'TC3-HMAC-SHA256',
			timestamp,
			scope,
			createHash('sha256').update(canonical).digest('hex')
		].join('\n');
		const hmac = (k: Buffer | string, data: string) =>
			createHmac('sha256', k).update(data).digest();
		const k_signing = hmac(hmac(hmac('TC3SKexample456', date), 'teo'), 'tc3_request');
		const expected_sig = createHmac('sha256', k_signing).update(string_to_sign).digest('hex');
		expect(headers.authorization).toBe(
			`TC3-HMAC-SHA256 Credential=AKIDexample123/${scope}, SignedHeaders=content-type;host;x-tc-action, Signature=${expected_sig}`
		);

		expect(JSON.parse(payload)).toEqual({
			ZoneId: 'zone-2abc999',
			Type: 'purge_url',
			Targets: ['https://www.example.cn/zh/careers/search/']
		});
		expect(audits).toEqual([
			{
				timestamp: Number(timestamp),
				zoneId: 'zone-2abc999',
				type: 'purge_url',
				targets: ['https://www.example.cn/zh/careers/search/'],
				jobId: 'job-eo-1',
				requestId: 'req-eo-1'
			}
		]);
	});

	it('submits both decoded and encoded URLs when special characters are present, and tolerates malformed percent sequences', async () => {
		const edge = make_edgeone({ host: 'teo.intl.tencentcloudapi.com' });

		await edge.purgeUrl('/zh/产品/搜索/');
		expect(captured[0].url).toBe('https://teo.intl.tencentcloudapi.com/');
		expect(JSON.parse(String(captured[0].init.body))).toEqual({
			ZoneId: 'zone-2abc999',
			Type: 'purge_url',
			Targets: [
				'https://www.example.cn/zh/产品/搜索/',
				'https://www.example.cn/zh/%E4%BA%A7%E5%93%81/%E6%90%9C%E7%B4%A2/'
			]
		});

		await edge.purgeUrl('/zh/%E4%BA%A7%E5%93%81/');
		expect(JSON.parse(String(captured[1].init.body))).toEqual({
			ZoneId: 'zone-2abc999',
			Type: 'purge_url',
			Targets: ['https://www.example.cn/zh/%E4%BA%A7%E5%93%81/', 'https://www.example.cn/zh/产品/']
		});

		await edge.purgeUrl('/zh/100%bad');
		expect(JSON.parse(String(captured[2].init.body))).toEqual({
			ZoneId: 'zone-2abc999',
			Type: 'purge_url',
			Targets: ['https://www.example.cn/zh/100%bad', 'https://www.example.cn/zh/100%25bad']
		});
	});

	it('purges directories via purge_prefix with trailing slash and delete/invalidate method', async () => {
		const audits: EdgeOnePurgeAudit[] = [];
		const del_edge = make_edgeone({ onPurge: (a) => audits.push(a) });
		await del_edge.purgeWhere({ prefix: '/zh/product-range' });
		expect(JSON.parse(String(captured[0].init.body))).toEqual({
			ZoneId: 'zone-2abc999',
			Type: 'purge_prefix',
			Method: 'delete',
			Targets: ['https://www.example.cn/zh/product-range/']
		});
		expect(audits[0].method).toBe('delete');

		await del_edge.purgeWhere({ prefix: '/' });
		expect(JSON.parse(String(captured[1].init.body))).toEqual({
			ZoneId: 'zone-2abc999',
			Type: 'purge_prefix',
			Method: 'delete',
			Targets: ['https://www.example.cn/']
		});

		const inv_edge = make_edgeone({ method: 'invalidate' });
		await inv_edge.purgeWhere({ prefix: '/zh/product-range/' });
		expect(JSON.parse(String(captured[2].init.body))).toEqual({
			ZoneId: 'zone-2abc999',
			Type: 'purge_prefix',
			Method: 'invalidate',
			Targets: ['https://www.example.cn/zh/product-range/']
		});
	});

	it('stamps cache-tag headers, enforces variant safety, reserves structural tags on >128 overflow, and batches purgeTags', async () => {
		const plain = make_edgeone({ maxAge: 7200 });
		expect(plain.headers({ url: '/zh/home/', ttl: 60, variants: [['hero', 'b']] })).toEqual({
			'cache-control': 'private, no-store'
		});
		expect(make_edgeone().headers({ url: '/zh/no-ttl', ttl: 0 })['cache-control']).toBeUndefined();

		const keyed = make_edgeone({ variants: { header: 'x-og-variants' }, maxAge: 7200 });
		const overflow_tags = Array.from({ length: 140 }, (_, i) => `site_cn_cat_${i}`);
		const h = keyed.headers({
			url: '/zh/product-range/item/',
			ttl: 600,
			tags: [' site_cn ', ...overflow_tags],
			variants: [['banner', 'red']]
		});
		expect(h['cache-control']).toBe('public, s-maxage=7200');
		const tags = h['cache-tag'].split(',');
		expect(tags).toHaveLength(128);
		expect(tags).toContain('site_cn');
		expect(tags).toContain(akamai_prefix_tag('/zh'));
		expect(tags).toContain(akamai_prefix_tag('/zh/product-range'));
		expect(tags).toContain(akamai_url_tag('/zh/product-range/item/'));
		expect(tags).toContain('og_flag_banner');
		expect(tags).toContain('og_exp_banner_red');

		await keyed.purgeUrl('/zh/product-range/item/');
		expect(JSON.parse(String(captured[0].init.body))).toEqual({
			ZoneId: 'zone-2abc999',
			Type: 'purge_tag',
			Targets: [akamai_url_tag('/zh/product-range/item/')]
		});

		await keyed.purgeTags(['   ']);
		expect(captured).toHaveLength(1);

		const large_tags = Array.from({ length: EDGEONE_MAX_TARGETS + 5 }, (_, i) => `tag_${i}`);
		await keyed.purgeTags(large_tags);
		expect(captured).toHaveLength(3);
		expect(
			(JSON.parse(String(captured[1].init.body)) as { Targets: string[] }).Targets
		).toHaveLength(EDGEONE_MAX_TARGETS);
		expect(
			(JSON.parse(String(captured[2].init.body)) as { Targets: string[] }).Targets
		).toHaveLength(5);
	});

	it('throws postrender_adapter_request_failed on HTTP failure, API Error envelope, or non-empty FailedList', async () => {
		const edge = make_edgeone({ onPurge: () => {} });

		vi.stubGlobal('fetch', async () => new Response('gateway timeout', { status: 502 }));
		await expect(edge.purgeUrl('/zh/a')).rejects.toThrow(/edgeone purge failed: 502/);

		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(
					JSON.stringify({
						Response: {
							Error: { Code: 'AuthFailure.SignatureFailure', Message: 'invalid signature' },
							RequestId: 'r-err'
						}
					}),
					{ status: 200 }
				)
		);
		await expect(edge.purgeUrl('/zh/a')).rejects.toThrow(/AuthFailure\.SignatureFailure/);

		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(
					JSON.stringify({
						Response: {
							JobId: 'j-partial',
							FailedList: [{ Target: 'https://www.example.cn/zh/a', Reason: 'invalid zone' }],
							RequestId: 'r-fail'
						}
					}),
					{ status: 200 }
				)
		);
		await expect(edge.purgeUrl('/zh/a')).rejects.toThrow(/invalid zone/);

		const bare_audits: EdgeOnePurgeAudit[] = [];
		const bare_edge = make_edgeone({ onPurge: (a) => bare_audits.push(a) });
		vi.stubGlobal('fetch', async () => new Response('not-json', { status: 200 }));
		await bare_edge.purgeUrl('/zh/ok');
		vi.stubGlobal('fetch', async () => new Response('', { status: 200 }));
		await bare_edge.purgeUrl('/zh/ok2');
		expect(bare_audits).toHaveLength(2);
		expect(bare_audits[0].jobId).toBeUndefined();

		vi.stubGlobal(
			'fetch',
			async () =>
				({
					ok: false,
					status: 503,
					text: () => Promise.reject(new Error('stream broke'))
				}) as unknown as Response
		);
		await expect(bare_edge.purgeUrl('/zh/fail')).rejects.toThrow(/edgeone purge failed: 503/);
	});

	it('round-trips caching and URL/directory/tag purges against the real edgeone emulator', async () => {
		vi.unstubAllGlobals();
		let origin_hits = 0;
		const edge_ref: { current: EdgeOneEdge | null } = { current: null };
		const origin = http.createServer((req, res) => {
			origin_hits++;
			const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
			const extra = edge_ref.current!.headers({
				url: pathname,
				ttl: 300,
				tags: ['site_cn', 'site_cn_range']
			});
			res.writeHead(200, { 'content-type': 'text/html', ...extra });
			res.end(`<html>v${origin_hits}:${pathname}</html>`);
		});
		await new Promise<void>((r) => origin.listen(0, '127.0.0.1', () => r()));
		const origin_port = (origin.address() as { port: number }).port;
		let emu: EdgeEmulator | null = null;
		try {
			emu = await start_edge_emulator({
				name: 'edgeone',
				port: 0,
				upstream: `http://127.0.0.1:${origin_port}`
			});
			const edge = make_edgeone({ baseUrl: emu.base, site: emu.base });
			edge_ref.current = edge;

			const r1 = await fetch(`${emu.base}/zh/product-range/item-1`);
			expect(r1.headers.get('x-edge-edgeone')).toBe('miss');
			const r2 = await fetch(`${emu.base}/zh/product-range/item-1`);
			expect(r2.headers.get('x-edge-edgeone')).toBe('hit');

			await fetch(`${emu.base}/zh/product-range/item-2`);
			await fetch(`${emu.base}/zh/careers/search/`);
			expect(emu.state().keys).toHaveLength(3);

			await edge.purgeWhere({ prefix: '/zh/product-range/' });
			expect(emu.state().keys).toEqual(['/zh/careers/search/']);

			await edge.purgeTags(['site_cn']);
			expect(emu.state().keys).toEqual([]);
			expect(emu.state().purges.every((p) => p.auth_ok)).toBe(true);
		} finally {
			await emu?.close();
			await new Promise<void>((r) => origin.close(() => r()));
		}
	});
});
