// Region hydrated over its own server HTML, for every place a browser hydrates one: Kit's pass over a
// csr=true document, an island's hydrate over the regions nested in it, a live snippet's body. The
// server's head and body go into the document, the same regions hydrate over them, and what comes
// out is snapshotted: what Svelte said, and whether the server's nodes were kept.
import { afterEach, expect, inject, test, vi } from 'vitest';
import { hydrate, unmount, type Component } from 'svelte';
import { from_b64 } from './b64.ts';
import RegionUnder from '../_fixtures/RegionUnder.svelte';
import { HYDRATE_CASES, place_setup } from './fixtures/hydrate-cases.ts';
import { runtime_session } from '../../src/runtime/session.ts';

const SSR: Record<string, { head: string; body: string }> = JSON.parse(
	from_b64(inject('region_hydrate_cases_b64'))
);

afterEach(() => {
	runtime_session.kit_page = undefined;
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

for (const [name, regions, place] of HYDRATE_CASES)
	test(name, async () => {
		const said: string[] = [];
		const keep = (...a: unknown[]) => void said.push(a.map(String).join(' '));
		vi.spyOn(console, 'warn').mockImplementation(keep);
		vi.spyOn(console, 'error').mockImplementation(keep);
		if (place.csr) runtime_session.kit_page = true;
		const { head, body } = SSR[name];
		const range = document.createRange();
		range.selectNodeContents(document.head);
		const head_nodes = range.createContextualFragment(head);
		const server_head = [...head_nodes.childNodes];
		document.head.prepend(head_nodes);
		const target = document.body.appendChild(document.createElement('div'));
		target.innerHTML = body;
		const server_nodes = [...target.querySelectorAll('*')];
		const app = hydrate(RegionUnder as unknown as Component<Record<string, unknown>>, {
			target,
			props: { setup: place_setup(place), regions: regions() }
		});
		const kept_body = server_nodes.every((n) => target.contains(n));
		const kept_head = server_head.every((n) => document.head.contains(n));
		const result = {
			server_head: head,
			head_gone: server_head
				.filter((n) => !document.head.contains(n))
				.map((n) => (n as Element).outerHTML ?? `<!--${n.textContent}-->`),
			server_body: body,
			body_after: target.innerHTML,
			kept_body,
			kept_head,
			said
		};
		await unmount(app);
		for (const n of server_head) n.remove();
		expect(said.filter((s) => s.includes('hydration'))).toEqual([]);
		expect(JSON.stringify(result, null, 1)).toMatchSnapshot();
	});
