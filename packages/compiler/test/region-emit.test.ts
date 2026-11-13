import { describe, expect, it } from 'vitest';
import {
	FOREIGN_HYDRATE_MARK,
	component_import_line,
	island_entry_source,
	island_wrapper_client_source,
	island_wrapper_source,
	lake_wrapper_source,
	make_region_binding,
	make_wake_island,
	rewrite_lake_import_to_placeholder,
	server_wrapper_source
} from '../src/compiler/region/emit.ts';

const COMPONENT = '/app/src/lib/Block.svelte';
const ENTRY = 'ogygia:region/entry/abc123.js';
const URL = '/_app/immutable/og-region.abc123.js';

const held = (extra: { hydrate?: string; hydrateMargin?: string } = {}) =>
	make_region_binding({
		iid: 'abc123',
		componentPath: COMPONENT,
		entryPath: ENTRY,
		hostPath: '/app/src/lib/registry.ts',
		moduleUrl: URL,
		identity: 'x',
		...extra
	});

const wake = (strategy: string, options?: Record<string, unknown>) =>
	make_wake_island({
		iid: 'abc123',
		componentPath: COMPONENT,
		entryPath: ENTRY,
		wrapperPath: 'ogygia:region/wrapper/abc123.svelte',
		moduleUrl: URL,
		strategy,
		options,
		hostPath: '/app/src/routes/+page.svelte',
		identity: 'x'
	});

describe('the island entry', () => {
	it('registers the transportable codecs before the component, so a prop decodes without its class', () => {
		const src = island_entry_source(COMPONENT, 'abc123');
		expect(src.startsWith(`import 'ogygia:region/transportables-eager';\n`)).toBe(true);
	});

	it('cut at the foreign-hydrate mark, the entry imports nothing of the runtime', () => {
		const src = island_entry_source(COMPONENT, 'abc123');
		const own = src.slice(0, src.indexOf(FOREIGN_HYDRATE_MARK));
		expect(own).toContain('export default __OgygiaComp_abc123;');
		expect(own).not.toContain('ogygia/internal');
	});

	it("an export named 'default' imports the default, any other name imports that export", () => {
		expect(component_import_line('X', './A.svelte', 'default')).toBe(`import X from "./A.svelte";`);
		expect(component_import_line('X', './A.svelte')).toBe(`import X from "./A.svelte";`);
		expect(component_import_line('X', '@scope/blocks', 'Header')).toBe(
			`import { Header as X } from "@scope/blocks";`
		);
	});
});

describe('the island wrapper', () => {
	it('hands children to Region as a prop, so a childless call site passes no slot', () => {
		const ssr = island_wrapper_source(
			'abc123',
			COMPONENT,
			ENTRY,
			'load',
			undefined,
			undefined,
			URL
		);
		const client = island_wrapper_client_source(
			'abc123',
			'ogygia:region/lazy/abc123.js',
			'load',
			undefined,
			URL
		);
		for (const src of [ssr, client]) {
			expect(src).toContain('{__props} {children} />');
			expect(src).not.toContain('{@render');
		}
	});
});

describe('the held binding', () => {
	it('renders through the shared helper and tells it whether the region wakes', () => {
		expect(held().bindingSsrSource).toContain(
			`__renderHtml: (props, wakes) => __ogRegionHtml(__ogRegionComp, "${URL}", props, wakes)`
		);
	});

	it('bakes a rootMargin only beside a baked schedule', () => {
		expect(held({ hydrateMargin: '100px' }).bindingSsrSource).not.toContain('__hydrateMargin');
		expect(held({ hydrate: 'visible', hydrateMargin: '100px' }).bindingSsrSource).toContain(
			'__hydrateMargin: "100px"'
		);
	});
});

describe('the wake binding', () => {
	it('its client leg is metadata only: no component, no signer, no server import', () => {
		const r = wake('load');
		expect(r.bindingSsrSource).toContain('__component: __ogRegionComp, __sign: __ogRegionSign');
		for (const banned of ['ogygia/internal/server', '__sign', '__component', COMPONENT])
			expect(r.bindingClientSource).not.toContain(banned);
	});

	it('bakes a margin only for the visible schedule', () => {
		expect(wake('idle', { margin: '200px' }).bindingClientSource).not.toContain('__hydrateMargin');
		expect(wake('visible', { margin: '200px' }).bindingClientSource).toContain(
			'__hydrateMargin: "200px"'
		);
	});
});

describe('the server-region wrapper', () => {
	it('its client leg imports no component: a hole ships no JS', () => {
		const ssr = server_wrapper_source('abc123', COMPONENT, ENTRY, {}, undefined, URL);
		const client = server_wrapper_source('abc123', COMPONENT, ENTRY, {}, undefined, URL, false);
		expect(ssr).toContain('__component={__OgygiaEntry} __css={__OgygiaCss}');
		for (const banned of [COMPONENT, ENTRY, '__component', '__css'])
			expect(client).not.toContain(banned);
	});

	it('carries the stitch mode to the hole', () => {
		const src = server_wrapper_source(
			'abc123',
			COMPONENT,
			ENTRY,
			{ stitch: 'edge' },
			undefined,
			URL
		);
		expect(src).toContain('__stitch={"edge"}');
	});

	it('a deferred region that hydrates carries its module and its hydrate margin', () => {
		const options = { hydrate: 'visible', hydrateMargin: '50px' };
		const src = server_wrapper_source('abc123', COMPONENT, ENTRY, options, undefined, URL);
		expect(src).toContain(`__hydrate={"visible"} __module={"${URL}"} __hydrateMargin={"50px"}`);
	});
});

describe('the lake wrapper', () => {
	it('only an swr lake carries an endpoint schedule and its margin; every lake hands Region its props', () => {
		const swr = lake_wrapper_source(
			'abc123',
			COMPONENT,
			{ remount: 'swr', margin: '10px' },
			undefined
		);
		expect(swr).toContain('__props={__props} __when={"load"} __margin={"10px"}');
		const cache = lake_wrapper_source('abc123', COMPONENT, { margin: '10px' }, undefined);
		expect(cache).toContain('__remount={"cache"} __props={__props}');
		for (const banned of ['__when', '__margin']) expect(cache).not.toContain(banned);
	});

	it('the placeholder rewrite matches a named import by its local name, not its exported one', () => {
		const ph = 'ogygia:lake-placeholder';
		const aliased = rewrite_lake_import_to_placeholder(
			`import { Foo as Lake, Bar } from './x';`,
			'Lake',
			ph
		);
		expect(aliased.startsWith(`import Lake from "${ph}";`)).toBe(true);
		expect(aliased).toContain(`import { Bar } from "./x"`);
		expect(aliased).not.toContain('Foo');
		const exported_only = `import { Lake as Other } from './x';`;
		expect(rewrite_lake_import_to_placeholder(exported_only, 'Lake', ph)).toBe(exported_only);
	});
});
