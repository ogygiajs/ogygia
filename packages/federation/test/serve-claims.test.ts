/**
 * The visitor claims a signed call carries reach the exposed table and the widget, and nothing
 * else counts as identity: an unsigned `x-og-user` header never does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { federate } from '../src/federate.ts';
import { set_federation } from '../src/registry.ts';
import { reset_deploy_thaw_for_tests, serve_federation } from '../src/serve.ts';
import { sign_headers, user, type Claims } from '../src/wire.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import fed_server from '../src/server.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
	reset_deploy_thaw_for_tests();
});

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

const forged = (claims: Claims) => Buffer.from(JSON.stringify(claims)).toString('base64');

/** cms.test exposing a table and one widget; records the identity each one was handed */
function cms(open = false): {
	table: (Claims | undefined)[];
	widget: (Claims | undefined)[];
} {
	const seen = {
		table: [] as (Claims | undefined)[],
		widget: [] as (Claims | undefined)[]
	};
	vi.stubGlobal('fetch', async () => new Response('{}'));
	federate({
		name: 'cms',
		audience: 'cms.test',
		peers: open ? {} : { shell: { origin: 'http://shell.test', key: pub } },
		open,
		expose: {
			fetch: async (req: Request) => {
				seen.table.push(user({ request: req }));
				return new Response('<html><head></head><body>ok</body></html>', {
					headers: { 'content-type': 'text/html' }
				});
			}
		} as never,
		widgets: {
			card: (_props, info) => {
				seen.widget.push(info.user);
				return { html: '<div>card</div>' };
			}
		}
	});
	return seen;
}

const page_url = () => new URL('http://cms.test/og/fragment/page?path=/me');
const widget_url = () => new URL('http://cms.test/og/fragment/card');

const call = (url: URL, headers: Record<string, string>) =>
	serve_federation({ url, request: new Request(url, { headers }) } as never);

describe('verified visitor claims reach what the call asked for', () => {
	it('a signed page call hands its claims to the exposed table', async () => {
		const seen = cms();
		const url = page_url();
		const res = (await call(url, sign_headers(priv, 'GET', url, undefined, { sub: 'u7' })))!;
		expect(res.status).toBe(200);
		expect(seen.table).toEqual([{ sub: 'u7' }]);
	});

	it('a signed widget call hands its claims to the widget', async () => {
		const seen = cms();
		const url = widget_url();
		const res = (await call(url, sign_headers(priv, 'GET', url, undefined, { sub: 'u8' })))!;
		expect(res.status).toBe(200);
		expect(seen.widget).toEqual([{ sub: 'u8' }]);
	});

	it('a signed call with no claims is anonymous', async () => {
		const seen = cms();
		const url = page_url();
		await call(url, sign_headers(priv, 'GET', url));
		expect(seen.table).toEqual([undefined]);
	});

	it('an unsigned call is refused before the table or widget runs', async () => {
		const seen = cms();
		const page = (await call(page_url(), {
			'x-og-user': forged({ sub: 'admin' })
		}))!;
		const widget = (await call(widget_url(), {
			'x-og-user': forged({ sub: 'admin' })
		}))!;
		expect([page.status, widget.status]).toEqual([401, 401]);
		expect(seen).toEqual({ table: [], widget: [] });
	});

	it('on an open app a raw x-og-user header is no identity', async () => {
		const seen = cms(true);
		await call(page_url(), { 'x-og-user': forged({ sub: 'admin' }) });
		await call(widget_url(), { 'x-og-user': forged({ sub: 'admin' }) });
		expect(seen).toEqual({ table: [undefined], widget: [undefined] });
	});
});
