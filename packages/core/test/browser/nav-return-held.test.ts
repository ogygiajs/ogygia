// A ROUTER RETURN REUSES THE ANSWERS THE FRAME STORE STILL HOLDS (#1020). A page left keeps its
// holes' answers for the store's linger (`EVICT_TTL`, runtime/frame-store.ts), so a return within it
// shows them again without asking: the navigation's batch leaves a held address out, as the page's
// first batch does (frame-nav.ts `send_batches`).
import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { build_parcel, done_parcel } from '../../src/server/stream-regions.ts';

const ep = (sig: string) => `/__ogygia__?id=aaaaaaa1020&props=${sig}&exp=9999999999&sig=${sig}`;
const hole = (sig: string) =>
	`<ogygia-region render="defer" when="load" endpoint="${ep(sig)}"><p>…</p></ogygia-region>`;
const page = (title: string, body: string) =>
	'<!doctype html><html><head><meta name="ogygia-router" content="plain">' +
	`<title>${title}</title></head><body>${body}</body></html>`;

const real_fetch = window.fetch;
const home = location.href;
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	document.body.innerHTML = '';
});

test('a router return within the linger asks nothing for the holes the store holds', async () => {
	const asked: string[] = [];
	window.fetch = async (input, init) => {
		const u = new URL(String(input), location.href);
		if (init?.method === 'POST') {
			const calls = JSON.parse(String(init.body)) as string[];
			asked.push(...calls);
			const parcels = calls.map((c) =>
				build_parcel(new URL(c, location.href).searchParams.get('sig')!, `<p>${c.slice(-1)}</p>`)
			);
			return new Response(parcels.join('') + done_parcel(), { status: 200 });
		}
		if (u.pathname === '/__ogygia__') {
			asked.push(u.pathname + u.search);
			return new Response('<p>own</p>', { status: 200, headers: { 'content-type': 'text/html' } });
		}
		const html =
			u.pathname === '/held-1020' ? page('held', hole('a') + hole('b')) : page('other', '<p>x</p>');
		const res = new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
		Object.defineProperty(res, 'url', { value: u.href });
		return res;
	};
	document.body.innerHTML = '<p>home</p>';
	bootDev();
	const router = new SpaRouter();
	const held = new URL('/held-1020', location.href);
	const shown = () =>
		Array.from(document.querySelectorAll('ogygia-region'), (r) => r.textContent).join(',');
	await router.navigate(held);
	await expect.poll(shown).toBe('a,b');
	expect(asked.length).toBe(2);
	await router.navigate(new URL('/other-1020', location.href));
	await router.navigate(held);
	// (its holes show what the store held, and nothing more was asked)
	await expect.poll(shown).toBe('a,b');
	await new Promise((r) => setTimeout(r, 50));
	expect(asked).toEqual([ep('a'), ep('b')]);
});
