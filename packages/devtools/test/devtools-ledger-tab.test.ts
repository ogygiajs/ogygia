// The Bytes tab: with no island graph on the page it lists one row per island entry chunk (its
// instances counted), dearest first, and a page total; with one, the page's exact ledger.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Ledger } from '../src/devtools/bytes.ts';

type Twice = {
	name: string;
	copies: { file: string; bytes: number; from?: string }[];
	extra: number;
};

type Region = { entry: string; kind: string; wake: string };
type Bytes = { wire: number; raw: number; loaded: boolean };
const page = {
	regions: [] as Region[],
	bytes: {} as Record<string, Bytes>,
	transitive: {} as Record<string, { bytes: number; modules: number }>,
	runtime: '' as string
};

vi.mock('../src/devtools/regions.ts', async (real) => ({
	...(await real<typeof import('../src/devtools/regions.ts')>()),
	all_regions: () => page.regions,
	chunk_bytes: (entry: string) => page.bytes[entry] ?? { wire: 0, raw: 0, loaded: false },
	region_name: (entry: string) => entry.replace(/^\/|\.js$/g, ''),
	region_transitive: (entry: string) => page.transitive[entry] ?? null
}));
const graph = {
	ledger: null as Ledger | null,
	profiles: {} as Record<string, { assets: { twice: Twice[] } }>
};
vi.mock('../src/devtools/ledger-dom.ts', () => ({ page_ledger: () => graph.ledger }));
vi.mock('../src/devtools/profile-store.ts', () => ({
	profile_for: (path: string) => graph.profiles[path] ?? null,
	profiles_version: () => 0
}));

const { default: LedgerTab } = await import('../src/devtools/LedgerTab.svelte');

beforeEach(() => {
	vi.stubGlobal('location', { pathname: '/' });
	vi.stubGlobal('document', {
		querySelector: (sel: string) =>
			sel === 'script[data-ogygia-runtime]' && page.runtime
				? { getAttribute: () => page.runtime }
				: null
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	page.regions = [];
	page.bytes = {};
	page.transitive = {};
	page.runtime = '';
	graph.ledger = null;
	graph.profiles = {};
});

const text = (html: string) =>
	html
		.replace(/<!--[^>]*-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
/** Each body row's text, and the footer's. */
function table(html: string) {
	const body = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
	const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => text(m[1]));
	const foot = text(/<tfoot[^>]*>([\s\S]*?)<\/tfoot>/.exec(html)?.[1] ?? '');
	return { rows, foot };
}
const html = () => render(LedgerTab, { props: { tick: 0 } }).body;
const island = (entry: string): Region => ({ entry, kind: 'island', wake: 'load' });

describe('the Bytes tab, without an island graph', () => {
	it('lists one row per entry chunk, with how many regions share it', () => {
		page.regions = [island('/a.js'), island('/b.js'), island('/a.js')];
		page.bytes = { '/a.js': { wire: 2048, raw: 4096, loaded: true } };
		const { rows } = table(html());
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatch(/^a ×2 island · load 2\.0 kB/);
		expect(rows[1]).toMatch(/^b island · load cold/);
	});

	it('puts the dearest island first: by its whole subgraph, then by its own chunk', () => {
		page.regions = [island('/small.js'), island('/tiny.js'), island('/big.js'), island('/wire.js')];
		page.bytes = {
			'/wire.js': { wire: 3072, raw: 3072, loaded: true },
			'/tiny.js': { wire: 1024, raw: 1024, loaded: true }
		};
		page.transitive = {
			'/small.js': { bytes: 1024, modules: 2 },
			'/big.js': { bytes: 10240, modules: 9 }
		};
		const names = table(html()).rows.map((r) => r.split(' ')[0]);
		expect(names).toEqual(['big', 'small', 'wire', 'tiny']);
	});

	it('totals the loaded chunks and the runtime for the wire, and every subgraph for +deps', () => {
		page.regions = [island('/a.js'), island('/a.js'), island('/b.js'), island('/c.js')];
		page.bytes = {
			'/a.js': { wire: 1024, raw: 1024, loaded: true },
			'/b.js': { wire: 2048, raw: 2048, loaded: true },
			'/runtime.js': { wire: 4096, raw: 4096, loaded: true }
		};
		page.transitive = {
			'/a.js': { bytes: 10240, modules: 3 },
			'/c.js': { bytes: 5120, modules: 2 }
		};
		page.runtime = '/runtime.js';
		const { rows, foot } = table(html());
		expect(rows.at(-1)).toBe('ogygia runtime shared 4.0 kB —');
		expect(foot).toBe('page total unique · +deps 7.0 kB 15.0 kB');
	});
});

describe('the Bytes tab, with an island graph', () => {
	const ledger: Ledger = {
		rows: [
			{
				entry: '/a.js',
				name: 'A',
				kind: 'island',
				wake: 'load',
				count: 1,
				files: 3,
				wire: 3072,
				unique: 1024,
				shared: 2048,
				cold: 0
			}
		],
		page: { files: 4, wire: 5120, raw: 9216, cold: 0 },
		runtime: { files: 1, wire: 2048 },
		shared: []
	};

	it("shows the page's exact ledger in place of the per-chunk estimate", () => {
		page.regions = [island('/a.js')];
		graph.ledger = ledger;
		const out = html();
		expect(out).toContain('data-og-ledger-exact');
		const { rows, foot } = table(out);
		expect(rows[0]).toBe('A island · load 3 3.0 kB 1.0 kB 2.0 kB');
		expect(foot).toBe('page each file once 4 5.0 kB 9.0 kB decoded');
	});

	it("lists the modules this page's last profile loaded twice", () => {
		graph.ledger = ledger;
		graph.profiles['/'] = {
			assets: {
				twice: [
					{
						name: 'lib',
						copies: [
							{ file: '/x/lib.js', bytes: 2048, from: 'src' },
							{ file: '/y/lib.js', bytes: 2048 }
						],
						extra: 2048
					}
				]
			}
		};
		const out = html();
		expect(out).toContain('data-og-ledger-twice');
		expect(text(out)).toContain('lib 2.0 kB lib.js (src) · lib.js');
		graph.profiles = {};
		expect(html()).not.toContain('data-og-ledger-twice');
	});
});
