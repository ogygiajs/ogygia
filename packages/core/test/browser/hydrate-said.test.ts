// What a hydrate that met drift says, and where: the region's attribute, the devtools event, the
// `regionMismatched` hook, and the dev console. A heal (the server copy put back), a conflict (a web
// component's own nodes removed), a recovery (Svelte threw the server DOM away).
// (devtools on for this file: the gate is read off the global when the module is first imported)
import { afterEach, beforeAll, beforeEach, expect, inject, test, vi } from 'vitest';
import { from_b64 } from './b64.ts';
import type { Component } from 'svelte';
import { claims } from './_walk.ts';
import type { RegionMismatchedEvent } from '../../src/contract/runtime-hooks.ts';

(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
const { link_boot } = await import('../../src/runtime/boot-link.ts');
const { load_devalue } = await import('../../src/runtime/devalue-lane.ts');
const { slots } = await import('../../src/runtime/slots.ts');
const { snapshot, clear, configure } = await import('../../src/events/bus.ts');
const { hydrate_island } = await import('../../src/runtime/hydrate-core.ts');
const Counter = (await import('./fixtures/Counter.svelte')).default;

type Mod = { default: Component<Record<string, unknown>> };
const counter: Mod = { default: Counter as unknown as Component<Record<string, unknown>> };
let said: string[] = [];
let heard: RegionMismatchedEvent[] = [];
const events = (name: string) =>
	snapshot()
		.filter((e) => e.name === name)
		.map((e) => {
			const { entry, fp, reason } = e as unknown as Record<string, unknown>;
			return { entry, fp, reason };
		});

beforeAll(async () => {
	link_boot();
	await load_devalue();
});
beforeEach(() => {
	document.body.innerHTML = '';
	said = [];
	heard = [];
	clear();
	configure({ active: true, cap: 4096 });
	slots.hooks = { regionMismatched: (e) => void heard.push(e) };
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
		said.push(a.map(String).join(' '));
	});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	slots.hooks = undefined;
});

test('a healed island says why: on its attribute, a devtools event, the hook and the console', () => {
	document.body.innerHTML = from_b64(inject('counter_ssr_b64'));
	const region = document.querySelector('ogygia-region') as HTMLElement;
	region.setAttribute('data-og-fp', 'fp1');
	const entry = region.getAttribute('entry')!;
	const ssr = region.innerHTML;
	region.prepend(document.createElement('style'));
	expect(hydrate_island(region, entry, counter, ssr, true)).not.toBeNull();
	const reason = region.getAttribute('data-og-healed')!;
	expect(reason).toContain('<style>');
	expect(events('region.hydrate.healed')).toEqual([{ entry, fp: 'fp1', reason }]);
	expect(heard).toEqual([{ el: region, kind: 'healed', reason }]);
	expect(said.filter((s) => s.includes('island_healed'))).toHaveLength(1);
});

test('a conflict is said on a devtools event, the hook and the console, naming the element', () => {
	const region = document.createElement('ogygia-region');
	region.innerHTML = '<!--[--><details><summary>s</summary><i>own</i></details><!--]-->';
	document.body.append(region);
	const ssr = '<!--[--><details><summary>s</summary></details><!--]-->';
	const quiet = claims(1);
	expect(hydrate_island(region, '/quiet', quiet, ssr, true)).not.toBeNull();
	expect(events('region.hydrate.conflict')).toEqual([
		{ entry: '/quiet', fp: undefined, reason: '<details>' }
	]);
	expect(heard.filter((e) => e.kind === 'conflict')).toEqual([
		{ el: region, kind: 'conflict', reason: '<details>' }
	]);
	expect(said.filter((s) => s.includes('ownership_conflict'))).toHaveLength(1);
});

/** A component whose walk breaks on its first two runs (the strict attempt, then Svelte's own
 *  recovery's), then renders nothing: the server nodes are thrown away. */
function breaking(): { mod: Mod; runs: string[] } {
	const runs: string[] = [];
	const mod: Mod = {
		default: (() => {
			runs.push('run');
			console.warn(`own warning ${runs.length}`);
			if (runs.length <= 2) throw new TypeError('the walk broke');
		}) as unknown as Component<Record<string, unknown>>
	};
	return { mod, runs };
}

test('an island Svelte re-rendered says so everywhere, with what its strict attempt threw', () => {
	const region = document.createElement('ogygia-region');
	region.setAttribute('data-og-fp', 'fp2');
	region.innerHTML = '<!--[--><p>server</p><!--]-->';
	document.body.append(region);
	const { mod, runs } = breaking();
	expect(hydrate_island(region, '/breaks', mod, null, true)).not.toBeNull();
	expect(runs).toHaveLength(3);
	expect(region.getAttribute('data-og-recovered')).toBe('');
	expect(events('region.hydrate.recovered')).toEqual([
		{ entry: '/breaks', fp: 'fp2', reason: undefined }
	]);
	expect(heard).toEqual([{ el: region, kind: 'recovered' }]);
	const discarded = said.filter((s) => s.includes('hydration_discarded'));
	expect(discarded).toHaveLength(1);
	expect(discarded[0]).toContain(
		'Svelte threw on the strict attempt (after repair): hydration_failed'
	);
});

test('the strict attempt’s own "Failed to hydrate" line is not printed; the island’s own warnings are', () => {
	const region = document.createElement('ogygia-region');
	region.innerHTML = '<!--[--><p>server</p><!--]-->';
	document.body.append(region);
	const warn = console.warn;
	hydrate_island(region, '/breaks', breaking().mod, null, true);
	expect(console.warn, 'console.warn is put back').toBe(warn);
	expect(said.filter((s) => s.startsWith('own warning'))).toEqual([
		'own warning 1',
		'own warning 2',
		'own warning 3'
	]);
	expect(
		said.filter((s) => s.startsWith('Failed to hydrate')),
		'only the recovery’s'
	).toHaveLength(1);
});

test('an island that kept even one of its server elements is no recovery', () => {
	const region = document.createElement('ogygia-region');
	region.innerHTML = '<!--[--><p>kept</p><p>gone</p><!--]-->';
	document.body.append(region);
	const kept = region.querySelector('p')!;
	const mod = claims(1, () => region.querySelectorAll('p')[1].remove());
	hydrate_island(region, '/some', mod, null, true);
	expect(kept.isConnected).toBe(true);
	expect(region.hasAttribute('data-og-recovered')).toBe(false);
});

test('an island with no server elements is no recovery', () => {
	const region = document.createElement('ogygia-region');
	region.innerHTML = '<!--[-->text only<!--]-->';
	document.body.append(region);
	hydrate_island(region, '/text', claims(1), null, true);
	expect(region.hasAttribute('data-og-recovered')).toBe(false);
});
