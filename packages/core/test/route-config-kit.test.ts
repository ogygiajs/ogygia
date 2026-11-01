import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	read_route_config,
	page_route_config,
	clear_route_csr_cache
} from '../src/compiler/kit.ts';
import { route_config, set_page_route_config, clear_route_config } from '../src/plugin/routes.ts';

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE CONFIG in Kit's file world — the keys a plugin claims inside Kit's own `config` page option
// (`export const config = { postrender: false }`; postrender's key is the example used here).
//
// Merged exactly the way Kit merges `config` at run time (layouts root → leaf, then the page; at each
// level the server module, then the universal one; later wins, top level only). A route that sets
// nothing carries no value (the plugin's own default applies at run time). Nothing is stripped: Kit
// accepts any key inside `config`. This suite pins the read, the merge, and the run-time answer.
// ─────────────────────────────────────────────────────────────────────────────

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	clear_route_csr_cache();
	clear_route_config();
});

/** Materialize a routes tree: `{ 'a/+page.svelte': '...' }` → tmp routes dir. */
function routes(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'og-route-config-'));
	dirs.push(root);
	for (const [rel, content] of Object.entries(files)) {
		const abs = join(root, rel);
		mkdirSync(join(abs, '..'), { recursive: true });
		writeFileSync(abs, content);
	}
	return root;
}

const KEYS = ['postrender'];

/** The value the postrender plugin acts on: the merged one, else its vite-config `default`. */
const effective = (
	config: Record<string, Record<string, unknown>>,
	id: string,
	fallback: boolean
) => {
	const v = config[id]?.postrender;
	return typeof v === 'boolean' ? v : fallback;
};

describe('read_route_config — export shapes', () => {
	it('reads the claimed key out of the object, typed or not; absent everywhere else', () => {
		const dir = routes({
			'on/+page.ts': 'export const config = { postrender: true };',
			'off/+page.ts': "export const config = { runtime: 'edge', postrender: false };",
			'typed/+page.ts':
				"import type { Config } from '@sveltejs/kit';\nexport const config: Config = { postrender: false };",
			'satisfies/+page.ts': 'export const config = { postrender: false } satisfies Config;',
			'const/+page.ts': "export const config = { 'postrender': true } as const;",
			'load/+page.server.ts': 'export const load = () => ({});',
			'commented/+page.ts':
				'// export const config = { postrender: true }\nexport const load = () => ({});',
			'other/+page.ts': 'export const config = { runtime: "edge" };'
		});
		const read = (f: string) => read_route_config(join(dir, f), KEYS);
		expect(read('on/+page.ts')).toEqual({ postrender: true });
		expect(read('off/+page.ts')).toEqual({ postrender: false }); // unclaimed keys stay Kit's
		expect(read('typed/+page.ts')).toEqual({ postrender: false });
		expect(read('satisfies/+page.ts')).toEqual({ postrender: false });
		expect(read('const/+page.ts')).toEqual({ postrender: true });
		expect(read('load/+page.server.ts')).toEqual({});
		expect(read('commented/+page.ts')).toEqual({});
		expect(read('other/+page.ts')).toEqual({});
		expect(read('nope/+page.ts')).toEqual({}); // absent file
	});

	it('a claimed key with a computed value is a build error naming the file and key', () => {
		const dir = routes({ 'a/+page.ts': 'export const config = { postrender: !dev };' });
		expect(() => read_route_config(join(dir, 'a/+page.ts'), KEYS)).toThrow(
			/config\.postrender` must be a literal/
		);
	});

	it('nothing is stripped: the route module stays exactly what Kit reads', () => {
		const src = 'export const config = { postrender: false };\nexport const load = () => ({});\n';
		const dir = routes({ 'a/+page.ts': src });
		read_route_config(join(dir, 'a/+page.ts'), KEYS);
		expect(readFileSync(join(dir, 'a/+page.ts'), 'utf8')).toBe(src);
	});
});

describe('page_route_config — Kit’s merge', () => {
	it('a layout sets the key, children inherit it, a page overrides it; unset is absent', () => {
		const dir = routes({
			'+page.svelte': '<h1>home</h1>', // nothing set → absent
			'docs/+layout.ts': 'export const config = { postrender: true };', // the subtree on
			'docs/+page.svelte': '<h1>docs</h1>', // inherits → true
			'docs/guide/+page.svelte': '<h1>guide</h1>', // inherits deeper → true
			'docs/draft/+page.svelte': '<h1>draft</h1>',
			'docs/draft/+page.ts': 'export const config = { postrender: false };' // page wins → false
		});
		const config = page_route_config(dir, KEYS);
		expect(config).toEqual({
			'/': {},
			'/docs': { postrender: true },
			'/docs/guide': { postrender: true },
			'/docs/draft': { postrender: false }
		});
		// with the plugin's `default: false` applied at run time, only the pages set true store
		expect(effective(config, '/', false)).toBe(false);
		expect(effective(config, '/docs/guide', false)).toBe(true);
		expect(effective(config, '/docs/draft', false)).toBe(false);
	});

	it('a layout turns a subtree off and a page below turns itself back on', () => {
		const dir = routes({
			'+page.svelte': '<h1>home</h1>',
			'account/+layout.server.ts': 'export const config = { postrender: false };',
			'account/+page.svelte': '<h1>account</h1>',
			'account/orders/+page.svelte': '<h1>orders</h1>',
			'account/public/+page.svelte': '<h1>public</h1>',
			'account/public/+page.server.ts': 'export const config = { postrender: true };'
		});
		const config = page_route_config(dir, KEYS);
		expect(config['/account']).toEqual({ postrender: false });
		expect(config['/account/orders']).toEqual({ postrender: false });
		expect(config['/account/public']).toEqual({ postrender: true });
		expect(effective(config, '/', true)).toBe(true);
		expect(effective(config, '/account/orders', true)).toBe(false);
	});

	it('at one level the universal module beats the server module, as in Kit', () => {
		const dir = routes({
			'a/+page.svelte': '<h1>a</h1>',
			'a/+page.server.ts': 'export const config = { postrender: true };',
			'a/+page.ts': 'export const config = { postrender: false };',
			'b/+layout.server.ts': 'export const config = { postrender: false };',
			'b/+layout.ts': 'export const config = { postrender: true };',
			'b/+page.svelte': '<h1>b</h1>'
		});
		const config = page_route_config(dir, KEYS);
		expect(config['/a']).toEqual({ postrender: false });
		expect(config['/b']).toEqual({ postrender: true });
	});

	it('the merge is per key: a deeper config without the key keeps the outer value', () => {
		const dir = routes({
			'+layout.ts': 'export const config = { postrender: false, other: 1 };',
			'a/+page.svelte': '<h1>a</h1>',
			'a/+page.ts': "export const config = { runtime: 'edge', other: 2 };"
		});
		const config = page_route_config(dir, ['postrender', 'other']);
		expect(config['/a']).toEqual({ postrender: false, other: 2 });
	});

	it('a redirect-only route (a `+page.server.ts` with no component) is a page too', () => {
		const dir = routes({
			'old/+page.server.ts':
				'export const config = { postrender: true };\nexport const load = () => { throw 1; };'
		});
		expect(page_route_config(dir, KEYS)['/old']).toEqual({ postrender: true });
	});

	it('strips (group) segments so the id matches Kit route.id normalization', () => {
		const dir = routes({
			'(app)/dash/+page.svelte': '<h1>dash</h1>',
			'(app)/dash/+page.ts': 'export const config = { postrender: true };'
		});
		const config = page_route_config(dir, KEYS);
		expect(config['/dash']).toEqual({ postrender: true });
		expect(config['/(app)/dash']).toBeUndefined();
	});

	it('baked values answer at run time by Kit route.id (groups and all); unset = undefined', () => {
		const dir = routes({
			'+page.svelte': '<h1>home</h1>',
			'(app)/dash/+page.svelte': '<h1>dash</h1>',
			'(app)/dash/+page.ts': 'export const config = { postrender: false };'
		});
		set_page_route_config(page_route_config(dir, KEYS));
		expect(route_config('postrender', '/(app)/dash', '/dash')).toBe(false);
		expect(route_config('postrender', '/', '/')).toBe(undefined);
		expect(route_config('postrender', null, '/dash')).toBe(undefined); // no route: never '/'
	});

	it('a route-file change is seen after the topology cache clears (the dev watcher)', () => {
		const dir = routes({
			'a/+page.svelte': '<h1>a</h1>',
			'a/+page.ts': 'export const config = { postrender: true };'
		});
		expect(page_route_config(dir, KEYS)['/a']).toEqual({ postrender: true });
		writeFileSync(join(dir, 'a/+page.ts'), 'export const config = { postrender: false };');
		clear_route_csr_cache();
		expect(page_route_config(dir, KEYS)['/a']).toEqual({ postrender: false });
	});
});
