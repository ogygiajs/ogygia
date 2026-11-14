// A host island adopts every lake in it in place, its own and those in a snippet it renders, live or
// frozen: nothing is moved, so a live snippet's later hydrate finds its lake exactly as served, nodes,
// anchors and order. Each one is settled and remembered when the host's hydrate releases them.
import { expect, test } from 'vitest';
import { hold, release } from '../../src/runtime/lakes.ts';
import { runtime_session } from '../../src/runtime/session.ts';

test('a host’s hold moves no lake, its own or a snippet’s, and its release settles every one', () => {
	document.body.innerHTML = `<ogygia-region wake="load" data-host><ogygia-region wake="none" entry="own"><p data-own>own</p><!----></ogygia-region><ogygia-snippet style="display:contents"><ogygia-region wake="none" entry="live"><p data-live>live</p><!----></ogygia-region></ogygia-snippet><ogygia-snippet data-og-static style="display:contents"><ogygia-region wake="none" entry="frozen"><p data-frozen>frozen</p></ogygia-region></ogygia-snippet></ogygia-region>`;
	const host = document.querySelector('[data-host]')!;
	const lakes = [...document.querySelectorAll('ogygia-region[wake="none"]')];
	const html = lakes.map((l) => l.innerHTML);

	const held = hold(host);
	expect(held.map((h) => h.id)).toEqual(['own', 'live', 'frozen']);
	expect(lakes.map((l) => l.innerHTML)).toEqual(html);

	release(host, held);
	expect(lakes.map((l) => l.innerHTML)).toEqual(html);
	for (const lake of lakes) expect(runtime_session.lake_settled(lake)).toBe(true);
	for (const id of ['own', 'live', 'frozen'])
		expect(runtime_session.initialized_lakes.has(id)).toBe(true);
});
