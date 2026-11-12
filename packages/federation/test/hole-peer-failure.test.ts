// FOUND BY THE SIMULATOR (generated app 19, seed 2): the shell's server hop to the peer for a
// deferred widget had its body cut midway, and the shell answered the page's hole 200 with no HTML.
// The region painted nothing (not its fallback), never asked again, and nothing was said. A fresh
// load showed the widget. serve.ts `serve_hole` answers every peer failure (down, 5xx, a cut or
// malformed body) with `answer('')`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { federate } from '../src/federate.ts';
import { set_federation } from '../src/registry.ts';
import { install_federation, serve_federation } from '../src/serve.ts';
import { fed_app } from '../src/app.ts';
import fed_server from '../src/server.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
// (core internals a test drives: the running code's request)
import { set_current_request } from '../../core/src/plugin/facts.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

afterEach(() => {
	vi.unstubAllGlobals();
	set_federation(null);
});

/** A deferred widget's hole, minted the way a render does (the handle's signer installed). */
async function widget_hole(): Promise<URL> {
	install_federation(fed_app()!);
	const request = new Request('http://shell/x');
	set_current_request(() => request);
	const { dash } = federate({ name: 'shell', peers: { dash: { origin: 'http://dash.test' } } });
	const hole = await dash.widget('kpis', { org: 'acme' }, { render: 'deferred' });
	set_current_request(null);
	return new URL((hole as { url: string }).url, 'http://shell');
}

/** The shell's hole endpoint, asked as the browser asks it. */
const ask = (u: URL) =>
	serve_federation({
		url: u,
		request: new Request(u),
		cookies: { get: () => undefined },
		locals: {}
	} as unknown as RequestEvent);

const failures: Array<[string, () => Promise<Response>]> = [
	['a body cut midway', async () => new Response('{"html":"<section>kp')],
	['a 503', async () => new Response('down', { status: 503 })],
	[
		'no answer at all',
		async () => {
			throw new TypeError('fetch failed');
		}
	]
];

describe("a deferred widget's hole when the peer fails", () => {
	it('answers the widget when the peer does', async () => {
		vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ html: '<p>kpis</p>' })));
		const res = (await ask(await widget_hole()))!;
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('<p>kpis</p>');
	});

	for (const [what, peer] of failures)
		it(`is not an empty success after ${what}: the page can show its fallback and ask again`, async () => {
			vi.stubGlobal('fetch', peer);
			const res = (await ask(await widget_hole()))!;
			expect(res.status).toBeGreaterThanOrEqual(500);
		});
});
