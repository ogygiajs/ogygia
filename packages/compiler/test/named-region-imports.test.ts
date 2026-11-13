// A region mark on a NAMED import (`import { A } from 'x' with { wake }`) is a region, in a `.svelte`
// host and in a `.ts` / `.js` module, exactly as `import.meta.og.asRegion(A, …)` made one: the
// entry imports the named export from the same specifier, and identity keys on `spec#Export`.
// `asRegion` itself is a build error that prints the import to write instead. The shapes a mark
// cannot turn into regions (a namespace, a bare import, a type-only import), and a marked binding
// used as anything but a component, are coded build errors.
import { describe, expect, test } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import {
	transformHost,
	transformTsRegions,
	regionIdentity,
	regionId,
	regionBindingVirtualId,
	wrapperVirtualId
} from '../src/compiler/region/transform.ts';
import type { MarkOptions } from '../src/compiler/region/ir.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

type HostCtx = Parameters<typeof transformHost>[2];
type TsCtx = Parameters<typeof transformTsRegions>[2];

const HOST = '/app/src/routes/+page.svelte';
const TS = '/app/src/lib/registry.ts';

function host_ctx(overrides: Partial<HostCtx> = {}): HostCtx {
	return {
		...HOST_CTX_DEFAULTS,
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_h: string, iid: string) => wrapperVirtualId(iid),
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets: {},
		...overrides
	};
}

const TS_CTX: TsCtx = {
	root: '/app',
	libDir: '/app/src/lib',
	dev: false,
	virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	devUrlFor: (p: string) => `/@id/${p}`,
	importKeys: undefined,
	visibleMargin: '0px'
};

const page = (script: string, markup: string, lang = '') => dedent`
	<script${lang ? ` lang="${lang}"` : ''}>
	${script}
	</script>

	${markup}
`;
const host = (script: string, markup: string, ctx = host_ctx()) =>
	transformHost(page(script, markup, 'ts'), HOST, ctx)!;
const ts = (code: string) => transformTsRegions(code, TS, TS_CTX);

/** The thrown error's code and message (`null` when nothing threw). */
function thrown(fn: () => unknown): { code: string; message: string } | null {
	try {
		fn();
	} catch (e) {
		return { code: (e as { code?: string }).code ?? '?', message: (e as Error).message };
	}
	return null;
}

const load = { strategy: 'load', options: {} };
const id_of = (base: string, mark: { strategy: string; options?: MarkOptions }) =>
	regionId(regionIdentity(base, mark));

describe('a marked named import in a .svelte host is a region', () => {
	test('the entry imports the named export; identity keys on spec#Export; <H/> stays', () => {
		const r = host(
			`import { Header } from '@acme/ui' with { wake: 'load' };`,
			'<Header title="Hi" />'
		);
		const iid = id_of('@acme/ui#Header', load);
		expect(r.islands.map((i) => i.id)).toEqual([iid]);
		expect(r.code).toContain(`import Header from ${JSON.stringify(regionBindingVirtualId(iid))};`);
		expect(r.code).toMatch(/<Header\s+title="Hi"\s*\/>/);
		expect(r.code).not.toMatch(/from ['"]@acme\/ui['"]/);
		expect(r.islands[0].source).toMatch(
			/import \{ Header as __OgygiaComp_[0-9a-f]+ \} from ["']@acme\/ui["']/
		);
		expect(r.islands[0].wrapperSource).toMatch(
			/import \{ Header as __OgygiaCss \} from ["']@acme\/ui["']/
		);
	});

	test('an alias binds the local name; identity still keys on the export name', () => {
		const r = host(`import { Ticker as Fast } from '@acme/ui' with { wake: 'load' };`, '<Fast />');
		const iid = id_of('@acme/ui#Ticker', load);
		expect(r.islands.map((i) => i.id)).toEqual([iid]);
		expect(r.code).toContain(`import Fast from ${JSON.stringify(regionBindingVirtualId(iid))};`);
		expect(r.islands[0].source).toMatch(/import \{ Ticker as __OgygiaComp_/);
	});

	test('one `with` covers every binding in the declaration: two exports, two regions', () => {
		const r = host(
			`import { Header, Footer as F } from '@acme/ui' with { wake: 'load' };`,
			'<Header /><F />'
		);
		expect(r.islands.map((i) => i.id).sort()).toEqual(
			[id_of('@acme/ui#Header', load), id_of('@acme/ui#Footer', load)].sort()
		);
		expect(r.code).toContain(
			`import Header from ${JSON.stringify(regionBindingVirtualId(id_of('@acme/ui#Header', load)))};`
		);
		expect(r.code).toContain(
			`import F from ${JSON.stringify(regionBindingVirtualId(id_of('@acme/ui#Footer', load)))};`
		);
	});

	test('a default and a named binding in one declaration are both regions', () => {
		const r = host(
			`import Card, { Badge } from './Card.svelte' with { wake: 'idle' };`,
			'<Card /><Badge />'
		);
		const idle = { strategy: 'idle', options: {} };
		expect(r.islands.map((i) => i.id).sort()).toEqual(
			[id_of('src/routes/Card.svelte', idle), id_of('src/routes/Card.svelte#Badge', idle)].sort()
		);
	});

	test('a binding the file never uses is dropped; the used one is still a region', () => {
		const r = host(
			`import { Header, Footer } from '@acme/ui' with { wake: 'load' };`,
			'<Header />'
		);
		expect(r.islands.map((i) => i.id)).toEqual([id_of('@acme/ui#Header', load)]);
		expect(r.code).not.toMatch(/\bFooter\b/);
	});

	test('a named default (`{ default as X }`) is the default export', () => {
		const r = host(
			`import { default as Card } from './Card.svelte' with { wake: 'load' };`,
			'<Card />'
		);
		expect(r.islands.map((i) => i.id)).toEqual([id_of('src/routes/Card.svelte', load)]);
	});

	test.each([
		[{ render: 'deferred', fetch: 'load' }, (i: Record<string, unknown>) => i.kind === 'defer'],
		[{ wake: 'none' }, (i: Record<string, unknown>) => i.kind === 'lake'],
		[{ region: 'raw' }, (i: Record<string, unknown>) => i.held === true]
	])('every mode works on a named import: %o', (attrs, ok) => {
		const w = Object.entries(attrs)
			.map(([k, v]) => `${k}: '${v}'`)
			.join(', ');
		const r = host(`import { Chart } from '@acme/ui' with { ${w} };`, '<Chart />');
		expect(r.islands).toHaveLength(1);
		expect(ok(r.islands[0] as never)).toBe(true);
		const i = r.islands[0];
		// a cache lake has no entry: its wrapper imports the component
		expect(String(i.source ?? i.bindingSsrSource ?? i.wrapperSource)).toMatch(
			/import \{ Chart as \w+ \} from ["']@acme\/ui["']/
		);
	});

	test('a preset resolves on a named import', () => {
		const r = host(
			`import { Panel } from '@acme/ui' with { preset: 'lazy' };`,
			'<Panel />',
			host_ctx({ presets: { lazy: { wake: 'visible', margin: '300px' } } })
		);
		expect(r.islands).toHaveLength(1);
		expect(r.islands[0].strategy).toBe('visible');
	});

	test('a marked binding handed on as a value stays legal (region(), a prop, this=)', () => {
		const r = host(
			dedent`
				import { Block } from '@acme/ui' with { region: 'raw' };
				import { Card } from '@acme/ui' with { wake: 'load' };
				import { region } from 'ogygia';
				const held = region(Block, {});
				const blocks = { card: Card };
			`,
			'<Card /><svelte:component this={blocks.card} /><Other comp={Card} />{#if Block}x{/if}'
		);
		expect(r.islands).toHaveLength(2);
	});

	test('a component prop whose name starts with "on" is a prop, not an event handler', () => {
		const r = host(
			`import { Card } from '@acme/ui' with { wake: 'load' };`,
			'<Card /><Tabs once={Card} /><List only={Card} /><Wizard onboarding={Card} /><Menu onselect={Card} />'
		);
		expect(r.islands).toHaveLength(1);
	});

	test('a marked binding typed with `typeof` in a type position is legal', () => {
		const r = host(
			dedent`
				import type { ComponentProps } from 'svelte';
				import { Card } from '@acme/ui' with { wake: 'load' };
				type P = ComponentProps<typeof Card>;
				const p: P = {} as P;
			`,
			'<Card {...p} />',
			host_ctx()
		);
		expect(r.islands).toHaveLength(1);
	});

	test('`void X` (kept referenced, never placed) and `!X` are not misuses', () => {
		const r = host(
			dedent`
				import { Card } from '@acme/ui' with { wake: 'load' };
				void Card;
				const missing = !Card;
			`,
			'<p>{missing}</p>'
		);
		expect(r.islands).toHaveLength(1);
	});

	test('a shadowing local of the same name is never read as a misuse', () => {
		const r = host(
			dedent`
				import { Card } from '@acme/ui' with { wake: 'load' };
				function f(Card: () => void) { return Card(); }
			`,
			'<Card />{f}'
		);
		expect(r.islands).toHaveLength(1);
	});
});

describe('a marked named import in a .ts module is a region', () => {
	test('the binding imports the named export; identity keys on spec#Export', () => {
		const r = ts(dedent`
			import { Header } from '@design/system' with { wake: 'visible' };
			export const registry = [{ name: 'header', component: Header }];
		`)!;
		expect(r.islands).toHaveLength(1);
		const isl = r.islands[0];
		expect(isl.held).toBe(true);
		expect(isl.id).toBe(
			id_of('@design/system#Header', {
				strategy: 'held',
				options: { hydrate: 'visible', hydrateMargin: '0px' }
			})
		);
		expect(String(isl.source)).toMatch(
			/import \{ Header as __OgygiaComp_[0-9a-f]+ \} from ["']@design\/system["']/
		);
		expect(r.code).toMatch(/^import Header from "ogygia:region\/binding\/[0-9a-f]{12}\.js";\n/);
	});

	test('aliases and several bindings: one binding import each', () => {
		const r = ts(dedent`
			import { Ticker as Fast, Block } from '@design/system' with { region: 'raw' };
			export const all = [Fast, Block];
		`)!;
		expect(r.islands).toHaveLength(2);
		expect(r.code).toMatch(
			/^import Fast from "ogygia:region\/binding\/[0-9a-f]{12}\.js";\nimport Block from "ogygia:region\/binding\/[0-9a-f]{12}\.js";\n/
		);
		expect(r.islands.map((i) => String(i.source)).join('\n')).toMatch(/\{ Ticker as __OgygiaComp_/);
	});

	test('a .ts file that re-exports a marked named binding exports the region', () => {
		const r = ts(dedent`
			import { Search } from '@ogygia/content' with { wake: 'idle' };
			export { Search };
		`)!;
		expect(r.islands).toHaveLength(1);
		expect(r.code).toMatch(
			/^import Search from "ogygia:region\/binding\/[0-9a-f]{12}\.js";\nexport \{ Search \};$/
		);
	});

	test('render: deferred on a named import is a hole', () => {
		const r = ts(
			`import { Chart } from '@x/ui' with { render: 'deferred', fetch: 'idle' };\nexport { Chart };`
		)!;
		expect(r.islands[0].kind).toBe('defer');
		expect(String(r.islands[0].source)).toMatch(/\{ Chart as __OgygiaComp_/);
	});
});

describe('import.meta.og.asRegion is a build error that prints the replacement', () => {
	test('in a .svelte host: a named import with the same options, aliased to the const', () => {
		const e = thrown(() =>
			host(
				dedent`
					import { Header, brand } from '@acme/ui';
					const H = import.meta.og.asRegion(Header, { wake: 'load' });
				`,
				'<H />{brand}'
			)
		);
		expect(e?.code).toBe('as_region_removed');
		expect(e?.message).toContain(`import { Header as H } from '@acme/ui' with { wake: 'load' };`);
	});

	test('a default import keeps the default form; same-name skips the alias', () => {
		const e = thrown(() =>
			host(
				dedent`
					import Card from './Card.svelte';
					import { Ticker } from '@acme/ui';
					const C = import.meta.og.asRegion(Card, { wake: 'idle' });
					const Ticker2 = import.meta.og.asRegion(Ticker, { render: 'deferred', fetch: 'load' });
				`,
				'<C /><Ticker2 />'
			)
		);
		expect(e?.code).toBe('as_region_removed');
		expect(e?.message).toContain(`import C from './Card.svelte' with { wake: 'idle' };`);
		expect(e?.message).toContain(
			`import { Ticker as Ticker2 } from '@acme/ui' with { render: 'deferred', fetch: 'load' };`
		);
	});

	test('in a .ts module', () => {
		const e = thrown(() =>
			ts(dedent`
				import { Block } from '@design/system';
				const BlockRegion = import.meta.og.asRegion(Block, { region: 'raw' });
				export const f = () => region(BlockRegion, {});
			`)
		);
		expect(e?.code).toBe('as_region_removed');
		expect(e?.message).toContain(
			`import { Block as BlockRegion } from '@design/system' with { region: 'raw' };`
		);
	});

	test('anywhere: nested, in markup, in a csr=true host, in <script module>', () => {
		const nested = `import { H } from 'x';\nfunction f() { return import.meta.og.asRegion(H, { wake: 'load' }); }`;
		expect(thrown(() => host(nested, '<div />'))?.code).toBe('as_region_removed');
		expect(thrown(() => ts(nested))?.code).toBe('as_region_removed');
		expect(
			thrown(() =>
				host(
					`import { H } from 'x';\nconst A = import.meta.og.asRegion(H, { wake: 'load' });`,
					'<A />',
					host_ctx({ routeCsr: true })
				)
			)?.code
		).toBe('as_region_removed');
		expect(
			thrown(() =>
				transformHost(
					dedent`
						<script module>
						import { H } from 'x';
						export const A = import.meta.og.asRegion(H, { wake: 'load' });
						</script>
						<div />
					`,
					HOST,
					host_ctx()
				)
			)?.code
		).toBe('as_region_removed');
	});
});

describe('shapes a region mark cannot carry', () => {
	const CASES: Array<[string, string]> = [
		[`import * as UI from '@acme/ui' with { wake: 'load' };`, 'region_import_namespace'],
		[`import Card, * as UI from './Card.svelte' with { wake: 'load' };`, 'region_import_namespace'],
		[`import '@acme/ui' with { wake: 'load' };`, 'region_import_bare'],
		[`import {} from '@acme/ui' with { wake: 'load' };`, 'region_import_bare'],
		[`import type { Card } from '@acme/ui' with { wake: 'load' };`, 'region_import_type_only'],
		[
			`import { type Card, Badge } from '@acme/ui' with { wake: 'load' };`,
			'region_import_type_only'
		]
	];
	test.each(CASES)('.svelte: %s → %s', (line, code) => {
		expect(thrown(() => transformHost(page(line, '<div />', 'ts'), HOST, host_ctx()))?.code).toBe(
			code
		);
	});
	test.each(CASES)('.ts: %s → %s', (line, code) => {
		expect(thrown(() => ts(`${line}\nexport const n = 1;`))?.code).toBe(code);
	});
});

describe('a marked binding used as anything but a component', () => {
	const SVELTE: Array<[string, string, string]> = [
		['called', `const x = Card();`, '<Card />'],
		['constructed', `const x = new Card({});`, '<Card />'],
		['read as a member', `const x = Card.helper;`, '<Card />'],
		['read as a member (computed)', `const x = Card['helper'];`, '<Card />'],
		['spread', `const x = { ...Card };`, '<Card />'],
		['spread into an array', `const x = [...Card];`, '<Card />'],
		['typeof (a value)', `const x = typeof Card;`, '<Card />'],
		['a template string', 'const x = `${Card}`;', '<Card />'],
		['a tagged template', 'const x = Card`a`;', '<Card />'],
		['a store', `const x = $Card;`, '<Card />'],
		['{@render}', ``, '{@render Card()}'],
		['text', ``, '<p>{Card}</p>'],
		['{@html}', ``, '{@html Card}'],
		['an action', ``, '<div use:Card></div>'],
		['a transition', ``, '<div transition:Card></div>'],
		['an attachment', ``, '<div {@attach Card}></div>'],
		['an event handler', ``, '<button onclick={Card}>x</button>'],
		['an event handler on svelte:window', ``, '<svelte:window onresize={Card} />'],
		['an event handler on svelte:element', ``, '<svelte:element this="div" onclick={Card} />'],
		['each', ``, '{#each Card as c}{c}{/each}'],
		['await', ``, '{#await Card}x{/await}'],
		['a spread attribute', ``, '<div {...Card}></div>'],
		['read as a member in markup', ``, '<p>{Card.name}</p>']
	];
	test.each(SVELTE)('.svelte: %s → region_binding_not_component', (_what, script, markup) => {
		const e = thrown(() =>
			host(`import { Card } from '@acme/ui' with { wake: 'load' };\n${script}`, markup)
		);
		expect(e?.code).toBe('region_binding_not_component');
		// the message names the line and says to split the import
		expect(e?.message).toMatch(/\+page\.svelte:\d+:\d+/);
		expect(e?.message).toContain(`import { Card } from '@acme/ui';`);
	});

	test('the default form is held to the same rule', () => {
		const e = thrown(() =>
			host(`import Card from './Card.svelte' with { wake: 'load' };\nCard();`, '<Card />')
		);
		expect(e?.code).toBe('region_binding_not_component');
		expect(e?.message).toContain(`import Card from './Card.svelte';`);
	});

	test('a merged import: the helper that rode along is named, with its own line', () => {
		const e = thrown(() =>
			host(
				`import { Search, formatQuery as fq } from '@ogygia/content' with { wake: 'idle' };\nconst q = fq('a');`,
				'<Search />'
			)
		);
		expect(e?.code).toBe('region_binding_not_component');
		expect(e?.message).toContain('+page.svelte:3:');
		expect(e?.message).toContain(`import { formatQuery as fq } from '@ogygia/content';`);
	});

	const TS_CASES: Array<[string, string]> = [
		['called', `export const x = Card();`],
		['constructed', `export const x = new Card({});`],
		['read as a member', `export const x = Card.helper;`],
		['spread', `export const x = { ...Card };`],
		['typeof (a value)', `export const x = typeof Card;`],
		['a template string', 'export const x = `${Card}`;']
	];
	test.each(TS_CASES)('.ts: %s → region_binding_not_component', (_what, use) => {
		const e = thrown(() => ts(`import { Card } from '@acme/ui' with { wake: 'load' };\n${use}`));
		expect(e?.code).toBe('region_binding_not_component');
		expect(e?.message).toMatch(/registry\.ts:2:\d+/);
	});

	test('.ts: the message names the line and column of the misuse', () => {
		const e = thrown(() =>
			ts(`import { Card } from '@acme/ui' with { wake: 'load' };\nexport const x = Card();`)
		);
		expect(e?.message).toContain('registry.ts:2:18');
	});

	test('.ts: a string-named import reads its export by that name', () => {
		const e = thrown(() =>
			ts(`import { "Card" as C } from '@acme/ui' with { wake: 'load' };\nexport const x = C();`)
		);
		expect(e?.message).toContain(`import { Card as C } from '@acme/ui';`);
	});

	test('.ts: values, exports, region() and type positions stay legal', () => {
		const r = ts(dedent`
			import type { ComponentProps } from 'svelte';
			import { Card } from '@acme/ui' with { wake: 'load' };
			export type P = ComponentProps<typeof Card>;
			export const registry = { card: Card, list: [Card] };
			export default Card;
			export { Card };
			export const pick = (k: string) => (k ? Card : null);
			export const held = region(Card, {});
		`)!;
		expect(r.islands).toHaveLength(1);
	});
});

describe('option errors on a named import are the default form’s errors', () => {
	const BAD = [
		`wake: 'whenever'`,
		`wake: 'load', margin: '10px'`,
		`region: 'cooked'`,
		`render: 'sometimes'`
	];
	test.each(BAD)('.svelte: with { %s }', (attrs) => {
		const d = thrown(() => host(`import Card from '@acme/ui' with { ${attrs} };`, '<Card />'));
		const n = thrown(() => host(`import { Card } from '@acme/ui' with { ${attrs} };`, '<Card />'));
		expect(d).not.toBeNull();
		expect(n).toEqual(d);
	});
	test.each(BAD)('.ts: with { %s }', (attrs) => {
		const d = thrown(() => ts(`import Card from '@acme/ui' with { ${attrs} };\nexport { Card };`));
		const n = thrown(() =>
			ts(`import { Card } from '@acme/ui' with { ${attrs} };\nexport { Card };`)
		);
		expect(d).not.toBeNull();
		expect(n).toEqual(d);
	});
});
