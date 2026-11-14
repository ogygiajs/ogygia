/**
 * A dev change invalidates exactly the virtual modules whose last load read what changed: each
 * `from`/`load` is a reader of the session's queries (`watch`), a part of the session read through
 * a tracked view of it is one input, and a query it reads is recorded too. A move of one part, or a
 * query whose answer changed, names the modules that read it, and no other.
 */
import { describe, expect, it } from 'vitest';
import { VirtualTable } from '../src/virtual/resolver.ts';
import { virtual, type Part } from '../src/virtual/table.ts';
import { CORE_PARTS, type CoreApp } from '../src/virtual/core.ts';
import { derived, input, queries, type Queries } from '../src/queries.ts';

/** A dev change to `part`: the modules it moved. */
function bump<A>(t: VirtualTable<A>, part: Part): string[] {
	t.move(part);
	return t.moved();
}

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
		PARTS,
		queries('session')
	);
}

/** Load `id` the way these tables' modules answer: at once. A module that answered later would be
 *  read after the test looked, so it fails here instead. */
function load_now(
	t: VirtualTable<App>,
	id: string,
	l: Parameters<VirtualTable<App>['load']>[2] = leg
): string | null | undefined {
	const source = t.load(id, app, l);
	if (source instanceof Promise)
		throw new Error(`${id} answered later; these loads answer at once`);
	return source;
}

function loaded(): VirtualTable<App> {
	const t = table();
	for (const id of ['opts', 'regs', 'routes', 'plugins', 'styles', 'routes-and-plugins', 'nothing'])
		load_now(t, R(id));
	return t;
}

describe('a dev change reloads exactly the modules that read it', () => {
	it('options: the modules that read the options', () => {
		expect(bump(loaded(), 'options')).toEqual([R('opts')]);
	});

	it('regions: the modules that read the regions', () => {
		expect(bump(loaded(), 'regions')).toEqual([R('regs')]);
	});

	it('routes: the modules that read the routes', () => {
		expect(bump(loaded(), 'routes').sort()).toEqual([R('routes'), R('routes-and-plugins')]);
	});

	it('plugins: the modules that read the plugin list', () => {
		expect(bump(loaded(), 'plugins').sort()).toEqual([R('plugins'), R('routes-and-plugins')]);
	});

	it('styles: the modules that read the style inputs', () => {
		expect(bump(loaded(), 'styles')).toEqual([R('styles')]);
	});

	it('leaves a module that reads no part untouched, whatever changes', () => {
		const t = loaded();
		for (const part of ['options', 'regions', 'routes', 'plugins', 'styles'] as const)
			expect(bump(t, part)).not.toContain(R('nothing'));
	});

	it('names a module once per load: reloaded, it is fresh until the part moves again', () => {
		const t = loaded();
		expect(bump(t, 'routes').length).toBe(2);
		expect(bump(t, 'routes')).toEqual([]);
		load_now(t, R('routes'));
		expect(bump(t, 'routes')).toEqual([R('routes')]);
	});

	it('names no module that was never loaded', () => {
		expect(bump(table(), 'routes')).toEqual([]);
	});

	it('a module whose server load read a part is named, though its browser load read nothing after', () => {
		const t = new VirtualTable<App>(
			[
				virtual.family<App>({
					realm: 'region',
					id: 'server-reads',
					load: (a, l) => `export const r = ${l.ssr ? JSON.stringify(a.routes()) : '[]'};`
				})
			],
			() => '',
			{},
			PARTS,
			queries('session')
		);
		const id = '\0ogygia:region/server-reads';
		load_now(t, id, { ssr: true, universalHooks: null });
		load_now(t, id, { ssr: false, universalHooks: null });
		expect(bump(t, 'routes')).toEqual([id]);
	});
});

describe('a load is a reader of the session’s queries', () => {
	/** Two files' sizes, and a fold over them with a cutoff (only whether any is big). */
	function session(db: Queries) {
		const size = input<string, number>(
			'size',
			(f) => f,
			() => 0
		);
		const total = derived<string, number>(
			'total',
			() => 'all',
			(cx) => cx.get(size, 'a') + cx.get(size, 'b')
		);
		const big = derived<string, boolean>(
			'big',
			() => 'all',
			(cx) => cx.get(total, 'all') > 10
		);
		const t = new VirtualTable<App>(
			[
				virtual.family<App>({
					realm: 'server',
					id: 'total',
					load: () => `export const t = ${db.get(total, 'all')};`
				}),
				virtual.family<App>({
					realm: 'server',
					id: 'big',
					load: () => `export const b = ${db.get(big, 'all')};`
				}),
				virtual.family<App>({
					realm: 'server',
					id: 'regs',
					load: (a) => `export const r = ${JSON.stringify(a.regions())};`
				})
			],
			() => '',
			{},
			PARTS,
			db
		);
		for (const id of ['total', 'big', 'regs']) load_now(t, R(id));
		return { t, size };
	}

	it('a query it read that changed names it, and only it', () => {
		const db = queries('session');
		const { t, size } = session(db);
		db.set(size, 'a', 3);
		expect(t.moved()).toEqual([R('total')]);
	});

	it('an answer that comes out the same names nobody (early cutoff)', () => {
		const db = queries('session');
		const { t, size } = session(db);
		db.set(size, 'a', 3);
		t.moved();
		load_now(t, R('total'));
		db.set(size, 'b', 20);
		expect(t.moved().sort()).toEqual([R('big'), R('total')]);
		load_now(t, R('total'));
		load_now(t, R('big'));
		db.set(size, 'b', 30);
		expect(t.moved()).toEqual([R('total')]);
	});

	it('a part moved names the modules that read it, beside any query that changed', () => {
		const db = queries('session');
		const { t, size } = session(db);
		db.set(size, 'a', 3);
		t.move('regions');
		expect(t.moved().sort()).toEqual([R('regs'), R('total')]);
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
