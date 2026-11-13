// A peer's fragment can hold regions of the peer's own: a server island inside a widget, a lake. Each
// carries the PEER's endpoint (`/__ogygia__?…`, signed by the peer). On the shell's page the browser
// asked the shell's endpoint for it, which knew neither the component nor the signature: 403
// foreign-key, and the fallback stood for good (#910). The fragment pins every endpoint of its own to
// its origin, and the shell turns each one on a configured peer's origin into a hole of its own,
// which forwards to the peer: same-origin for the browser (HOLE-TRUST), and the browser chooses no
// part of it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { decodeText } from '@ogygia/core/plugin/utils';
import { tags } from '@ogygia/core/internal/server';
import { federate } from '../src/federate.ts';
import { set_federation } from '../src/registry.ts';
import { install_federation, serve_federation } from '../src/serve.ts';
import { set_hole_signer } from '../src/hole.ts';
import { fed_app } from '../src/app.ts';
import { absolutize } from '../src/wire.ts';
import fed_server from '../src/server.ts';
import { set_current_request } from '../../core/src/plugin/facts.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

const DASH = 'https://dash.example';
/** A server island as the peer renders it: its hole, its fallback inside. */
const island = (endpoint: string) =>
	`<section><ogygia-region render="defer" when="load" endpoint="${endpoint}"><p>loading…</p></ogygia-region></section>`;
/** What the peer's own region endpoint answers: the island's render, an island of its own inside. */
const LATER =
	'<p>later</p><ogygia-region entry="/_app/immutable/og-region.000000000001.A.js"></ogygia-region>';

/** The upstream: the peer's widget catalog and its region endpoint. `endpoint` answers as given. */
function upstream(widget_html: string, endpoint: (u: URL) => Response = () => new Response(LATER)) {
	const asked: string[] = [];
	vi.stubGlobal('fetch', async (input: URL | string) => {
		const u = new URL(String(input));
		asked.push(u.href);
		if (u.pathname.startsWith('/og/fragment/'))
			return new Response(JSON.stringify({ html: absolutize(widget_html, u.origin) }));
		return endpoint(u);
	});
	return asked;
}

function shell() {
	install_federation(fed_app()!);
	const request = new Request('https://shell.example/x');
	set_current_request(() => request);
	return federate({ name: 'shell', peers: { dash: { origin: DASH } } });
}

/** The `endpoint` of each region in `html`, as the browser reads it. */
const endpoints = (html: string) =>
	[...tags(html, 'ogygia-region')].flatMap((t) => {
		const value = t.attr('endpoint');
		return value === undefined ? [] : [decodeText(value)];
	});

/** Ask the shell's handle for `url`, as the browser does. */
const ask = (url: string) => {
	const u = new URL(url, 'https://shell.example');
	return serve_federation({
		url: u,
		request: new Request(u),
		cookies: { get: () => undefined },
		locals: {}
	} as unknown as RequestEvent);
};

afterEach(() => {
	vi.unstubAllGlobals();
	set_federation(null);
	set_current_request(null);
	set_hole_signer(null);
});

describe("a region of the peer's own inside its fragment", () => {
	it('the fragment pins its region endpoints to its origin', () => {
		expect(absolutize(island('/__ogygia__?id=a&amp;sig=s'), DASH)).toContain(
			`endpoint="${DASH}/__ogygia__?id=a&amp;sig=s"`
		);
	});

	it('a static widget: the server island asks the shell, which asks the peer', async () => {
		const asked = upstream(island('/__ogygia__?id=a&amp;sig=s'));
		const { dash } = shell();
		const region = (await dash.widget('holder')) as { html: string };
		const [endpoint] = endpoints(region.html);
		// same-origin for the browser: a hole of the shell's own
		expect(endpoint.startsWith('/og/frag?')).toBe(true);
		const res = (await ask(endpoint))!;
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('<p>later</p>');
		// the answer's island loads from the peer
		expect(html).toContain(`entry="${DASH}/_app/immutable/og-region.000000000001.A.js"`);
		// the peer's own endpoint was asked, with its own signature
		expect(asked).toContain(`${DASH}/__ogygia__?id=a&sig=s`);
	});

	it('a deferred widget: the island inside its answer asks the shell too', async () => {
		upstream(island('/__ogygia__?id=a&amp;sig=s'));
		const { dash } = shell();
		const hole = (await dash.widget('holder', {}, { render: 'deferred' })) as { url: string };
		const html = await (await ask(hole.url))!.text();
		const [endpoint] = endpoints(html);
		expect(endpoint.startsWith('/og/frag?')).toBe(true);
		expect(await (await ask(endpoint))!.text()).toContain('<p>later</p>');
	});

	it("the peer's keep-fallback answer keeps the fallback", async () => {
		upstream(island('/__ogygia__?id=a'), () => new Response(null, { status: 204 }));
		const { dash } = shell();
		const [endpoint] = endpoints(((await dash.widget('holder')) as { html: string }).html);
		expect((await ask(endpoint))!.status).toBe(204);
	});

	it("an expired capability of the peer's is renewed by the peer", async () => {
		const exp = Math.floor(Date.now() / 1000) - 60;
		upstream(island(`/__ogygia__?id=a&amp;exp=${exp}&amp;sig=s`), (u) =>
			u.searchParams.get('renew') === '1'
				? new Response(LATER)
				: new Response('expired', { status: 403, headers: { 'x-ogygia-deny': 'expired' } })
		);
		const { dash } = shell();
		const [endpoint] = endpoints(((await dash.widget('holder')) as { html: string }).html);
		const res = (await ask(endpoint))!;
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('<p>later</p>');
	});

	it("a redirected or failed answer is not the region's: the shell says so, never swaps it in", async () => {
		upstream(
			island('/__ogygia__?id=a'),
			() => new Response(null, { status: 302, headers: { location: '/login' } })
		);
		const { dash } = shell();
		const [endpoint] = endpoints(((await dash.widget('holder')) as { html: string }).html);
		expect((await ask(endpoint))!.status).toBe(502);
	});

	it("an endpoint on any other origin is not the peer's: it stays as it came (the runtime refuses it)", async () => {
		const asked = upstream(
			island('https://evil.example/__ogygia__?id=a') + island('//evil.example/__ogygia__?id=b')
		);
		const { dash } = shell();
		const html = ((await dash.widget('holder')) as { html: string }).html;
		expect(endpoints(html)).toEqual([
			'https://evil.example/__ogygia__?id=a',
			'//evil.example/__ogygia__?id=b'
		]);
		expect(asked.some((u) => u.includes('evil'))).toBe(false);
	});

	it('the shell forwards only to the peer: a hole naming another path is refused', async () => {
		upstream(island('/__ogygia__?id=a'));
		const { dash } = shell();
		const [endpoint] = endpoints(((await dash.widget('holder')) as { html: string }).html);
		const forged = new URL(endpoint, 'https://shell.example');
		forged.searchParams.set('target', '//evil.example/x');
		expect((await ask(forged.pathname + forged.search))!.headers.get('x-ogygia-deny')).toBe('sig');
	});

	// the region tag is read the way the browser reads it, not by one quoting (#1370)
	for (const [what, tag] of [
		['in single quotes', `<ogygia-region render="defer" endpoint='/__ogygia__?id=a'>`],
		['unquoted', '<ogygia-region render="defer" endpoint=/__ogygia__?id=a>'],
		['spaced, in upper case', '<OGYGIA-REGION render="defer" ENDPOINT = "/__ogygia__?id=a">'],
		['after a value holding >', '<ogygia-region title="a>b" endpoint="/__ogygia__?id=a">']
	]) {
		it(`an endpoint ${what} asks the shell too`, async () => {
			upstream(`<section>${tag}<p>loading…</p></ogygia-region></section>`);
			const { dash } = shell();
			const html = ((await dash.widget('holder')) as { html: string }).html;
			const [endpoint] = endpoints(html);
			expect(endpoint.startsWith('/og/frag?')).toBe(true);
			// (not left pinned to the peer's origin, where the browser would ask the shell's endpoint)
			expect(html).not.toContain(DASH);
		});
	}

	it('an endpoint written inside another value is left as written', async () => {
		const decoy = ` endpoint="${DASH}/__ogygia__?id=x"`;
		upstream(
			`<ogygia-region render="defer" data-note='${decoy}' endpoint="/__ogygia__?id=a"></ogygia-region>`
		);
		const { dash } = shell();
		const html = ((await dash.widget('holder')) as { html: string }).html;
		expect(html).toContain(`data-note='${decoy}'`);
		expect(endpoints(html)[0]!.startsWith('/og/frag?')).toBe(true);
	});

	it('a region tag written in a script or a comment is no tag: left as it came', async () => {
		const written = '<ogygia-region endpoint="/__ogygia__?id=z">';
		upstream(`<script>s='${written}'</script><!-- ${written} -->`);
		const { dash } = shell();
		const html = ((await dash.widget('holder')) as { html: string }).html;
		expect(html).toContain(`<script>s='${written}'</script><!-- ${written} -->`);
	});
});
