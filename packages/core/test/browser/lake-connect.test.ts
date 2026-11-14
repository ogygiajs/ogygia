import { afterEach, expect, test } from 'vitest';
import { hold, on_frozen_connect, release } from '../../src/runtime/lakes.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import type { LakeArm } from '../../src/runtime/slots.ts';

let next = 0;
const unique = (name: string) => `lake-connect-${name}-${next++}`;

/** The arms a region hands its lake, counting what the lake asked of them. */
function arms() {
	const asked = { fetch: 0, idle: [] as (() => void)[] };
	const arm: LakeArm = {
		idle: (fire) => asked.idle.push(fire),
		visible: () => {},
		media: () => {},
		fetch_revalidate: () => asked.fetch++,
		wake_children: () => {}
	};
	return { arm, asked };
}

/** Parse `html` into the page and return the element `selector` names in it. */
function place(html: string, selector: string): HTMLElement {
	document.body.innerHTML = html;
	return document.querySelector<HTMLElement>(selector)!;
}

const lake = (entry: string, attrs = '', inner = '<p>server</p>') =>
	`<ogygia-region wake="none" entry="${entry}" data-lake ${attrs}>${inner}</ogygia-region>`;

afterEach(() => {
	document.body.innerHTML = '';
	document.head.querySelector('meta[name="ogygia-stored"]')?.remove();
});

test('a lake inside an island that will hydrate waits for that hydrate; any other lake is settled at its first connect', () => {
	const in_island = place(
		`<ogygia-region wake="load" entry="island.svelte">${lake(unique('in-island'))}</ogygia-region>`,
		'[data-lake]'
	);
	on_frozen_connect(in_island, arms().arm);
	expect(runtime_session.lake_settled(in_island), 'inside an island').toBe(false);

	const in_lake = place(
		`<ogygia-region wake="none" entry="${unique('outer')}">${lake(unique('in-lake'))}</ogygia-region>`,
		'[data-lake]'
	);
	on_frozen_connect(in_lake, arms().arm);
	expect(runtime_session.lake_settled(in_lake), 'inside a lake').toBe(true);

	const top = place(lake(unique('top')), '[data-lake]');
	on_frozen_connect(top, arms().arm);
	expect(runtime_session.lake_settled(top), 'at the top of the page').toBe(true);
});

test('a lake its island gives back keeps the copy taken first: a later hydrate of that island does not replace it', () => {
	const id = unique('first');
	const lk = place(
		`<ogygia-region wake="load" entry="island.svelte">${lake(id)}</ogygia-region>`,
		'[data-lake]'
	);
	const island = lk.parentElement!;
	release(island, hold(island));
	lk.innerHTML = '<p>changed on the client</p>';
	release(island, hold(island));
	const kept = runtime_session.lake_cache.peek(id);
	expect(kept && [...kept.frag.childNodes].map((n) => n.textContent)).toEqual(['server']);
});

test('a lake that comes back empty (remount="empty") keeps no copy; one that repaints (cache, swr) does', () => {
	for (const [policy, kept] of [
		['empty', false],
		['cache', true],
		['swr', true]
	] as const) {
		const id = unique(policy);
		const lk = place(
			`<ogygia-region wake="load" entry="island.svelte">${lake(id, `remount="${policy}"`)}</ogygia-region>`,
			'[data-lake]'
		);
		const island = lk.parentElement!;
		release(island, hold(island));
		expect(runtime_session.lake_cache.has(id), policy).toBe(kept);
	}
});

test('on a document served from a page store an swr lake revalidates at its first connect, on its schedule; a cache lake does not', () => {
	const meta = document.createElement('meta');
	meta.name = 'ogygia-stored';
	document.head.append(meta);

	const swr = arms();
	on_frozen_connect(
		place(lake(unique('stored-swr'), 'remount="swr" endpoint="/e"'), '[data-lake]'),
		swr.arm
	);
	expect(swr.asked.fetch, 'swr, when=load').toBe(1);

	const cached = arms();
	on_frozen_connect(
		place(lake(unique('stored-cache'), 'remount="cache" endpoint="/e"'), '[data-lake]'),
		cached.arm
	);
	expect(cached.asked.fetch, 'cache').toBe(0);

	const idle = arms();
	on_frozen_connect(
		place(lake(unique('stored-idle'), 'remount="swr" when="idle" endpoint="/e"'), '[data-lake]'),
		idle.arm
	);
	expect(idle.asked.fetch, 'swr, when=idle, before idle').toBe(0);
	expect(idle.asked.idle).toHaveLength(1);
	idle.asked.idle[0]();
	expect(idle.asked.fetch, 'swr, when=idle, at idle').toBe(1);
});

test('in dev, an swr lake with no region around it on a regular page says it will never revalidate', () => {
	const said: string[] = [];
	const real = console.warn;
	console.warn = (...args: unknown[]) => said.push(args.map(String).join(' '));
	try {
		const top_swr = unique('top-swr');
		on_frozen_connect(
			place(lake(top_swr, 'remount="swr" endpoint="/e"'), '[data-lake]'),
			arms().arm
		);
		const hosted_swr = unique('hosted-swr');
		on_frozen_connect(
			place(
				`<ogygia-region wake="load" entry="island.svelte">${lake(hosted_swr, 'remount="swr" endpoint="/e"')}</ogygia-region>`,
				'[data-lake]'
			),
			arms().arm
		);
		const top_cache = unique('top-cache');
		on_frozen_connect(place(lake(top_cache, 'remount="cache"'), '[data-lake]'), arms().arm);
	} finally {
		console.warn = real;
	}
	const no_host = said.filter((s) => s.includes('live_region_no_host'));
	expect(no_host).toHaveLength(1);
	expect(no_host[0]).toContain('lake-connect-top-swr');
});

test('a lake that first connects empty takes no copy: its server HTML, connecting later, is the one a remount repaints', () => {
	const id = unique('vacant-first');
	on_frozen_connect(place(lake(id, '', ''), '[data-lake]'), arms().arm);
	on_frozen_connect(place(lake(id), '[data-lake]'), arms().arm);
	const remounted = place(lake(id, '', ''), '[data-lake]');
	on_frozen_connect(remounted, arms().arm);
	expect(remounted.textContent).toBe('server');
});
