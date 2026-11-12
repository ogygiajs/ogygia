/**
 * A dev change invalidates exactly the virtual modules whose last load read the part that changed:
 * the table records what each `from`/`load` read off the session (a tracked view of it), each part
 * carries a stamp, and a bump of one part names the modules that read it, and no other.
 */
import { describe, expect, it } from 'vitest';
import { VirtualTable } from '../src/compiler/virtual/resolver.ts';
import { virtual, type Part } from '../src/compiler/virtual/table.ts';
import { CORE_PARTS, type CoreApp } from '../src/compiler/virtual/core.ts';

/** A session with one field per part, and one that is no part (read freely, never tracked). */
interface App {
	options: { ttl: number };
	regions: () => string[];
	routes: () => string[];
	plugins: { names: string[] };
	styles: () => string;
	label: string;
}
const PARTS: Readonly<Record<keyof App, Part | null>> = {
	options: 'options',
	regions: 'regions',
	routes: 'routes',
	plugins: 'plugins',
	styles: 'styles',
	label: null
};
const app: App = {
	options: { ttl: 1 },
	regions: () => ['a'],
	routes: () => ['/'],
	plugins: { names: ['p'] },
	styles: () => 'a{}',
	label: 'x'
};
const leg = { ssr: true, universalHooks: null };
const R = (id: string): string => `\0ogygia:server/${id}`;

function table(): VirtualTable<App> {
	return new VirtualTable<App>(
		[
			virtual.value<App, { ttl: number }>({
				realm: 'server',
				id: 'opts',
				from: (a) => ({ ttl: a.options.ttl })
			}),
			virtual.family<App>({
				realm: 'server',
				id: 'regs',
				load: (a) => `export const r = ${JSON.stringify(a.regions())};`
			}),
			virtual.family<App>({
				realm: 'server',
				id: 'routes',
				load: (a) => `export const r = ${JSON.stringify(a.routes())};`
			}),
			virtual.family<App>({
				realm: 'server',
				id: 'plugins',
				load: (a) => `export const p = ${JSON.stringify(a.plugins.names)};`
			}),
			virtual.family<App>({
				realm: 'server',
				id: 'styles',
				load: (a) => `export const s = ${JSON.stringify(a.styles())};`
			}),
			virtual.family<App>({
				realm: 'server',
				id: 'routes-and-plugins',
				load: (a) => `export const x = ${a.routes().length + a.plugins.names.length};`
			}),
			virtual.family<App>({
				realm: 'server',
				id: 'nothing',
				load: (a) => `export const l = ${JSON.stringify(a.label)};`
			})
		],
		() => '',
		{ 'ogygia:server/opts': ['ttl'] },
		PARTS
	);
}

function loaded(): VirtualTable<App> {
	const t = table();
	for (const id of ['opts', 'regs', 'routes', 'plugins', 'styles', 'routes-and-plugins', 'nothing'])
		t.load(R(id), app, leg);
	return t;
}

describe('a dev change reloads exactly the modules that read it', () => {
	it('options: the modules that read the options', () => {
		expect(loaded().bump('options')).toEqual([R('opts')]);
	});

	it('regions: the modules that read the regions', () => {
		expect(loaded().bump('regions')).toEqual([R('regs')]);
	});

	it('routes: the modules that read the routes', () => {
		expect(loaded().bump('routes').sort()).toEqual([R('routes'), R('routes-and-plugins')]);
	});

	it('plugins: the modules that read the plugin list', () => {
		expect(loaded().bump('plugins').sort()).toEqual([R('plugins'), R('routes-and-plugins')]);
	});

	it('styles: the modules that read the style inputs', () => {
		expect(loaded().bump('styles')).toEqual([R('styles')]);
	});

	it('leaves a module that reads no part untouched, whatever changes', () => {
		const t = loaded();
		for (const part of ['options', 'regions', 'routes', 'plugins', 'styles'] as const)
			expect(t.bump(part)).not.toContain(R('nothing'));
	});

	it('names a module once per load: reloaded, it is fresh until the part moves again', () => {
		const t = loaded();
		expect(t.bump('routes').length).toBe(2);
		expect(t.bump('routes')).toEqual([]);
		t.load(R('routes'), app, leg);
		expect(t.bump('routes')).toEqual([R('routes')]);
	});

	it('names no module that was never loaded', () => {
		expect(table().bump('routes')).toEqual([]);
	});

	it('a module whose server load read a part is named, though its browser load read nothing after', () => {
		const t = new VirtualTable<App>(
			[
				virtual.family<App>({
					realm: 'server',
					id: 'route-csr',
					// (reads the routes on the server leg only, as core's route-csr does)
					load: (a, l) => `export const r = ${l.ssr ? JSON.stringify(a.routes()) : '[]'};`
				})
			],
			() => '',
			{},
			PARTS
		);
		t.load(R('route-csr'), app, { ssr: true, universalHooks: null });
		t.load(R('route-csr'), app, { ssr: false, universalHooks: null });
		expect(t.bump('routes')).toEqual([R('route-csr')]);
	});
});

describe('core’s session parts', () => {
	it('give every field core’s entries read a part, or none on purpose', () => {
		const keys: (keyof CoreApp)[] = [
			'ctx',
			'program',
			'dollar_hoists',
			'prescan',
			'runtime_chunk_url',
			'region_names',
			'router_css_roots',
			'note_server_ids',
			'routes_dir',
			'plugins'
		];
		expect(Object.keys(CORE_PARTS).sort()).toEqual([...keys].sort());
		expect(CORE_PARTS.routes_dir).toBe('routes');
		expect(CORE_PARTS.plugins).toBe('plugins');
		expect(CORE_PARTS.router_css_roots).toBe('styles');
		expect(CORE_PARTS.program).toBe('regions');
	});
});
