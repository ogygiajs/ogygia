// A dynamic `import()` cannot be a region (a region needs a static marked import). Any region key in
// its `with` / `assert` bag is refused at build time with `dynamic_region_import`, in a `.svelte`
// host and in a `.ts` / `.js` module alike, instead of being left in place to do nothing.
import { describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import { transformHost, transformTsRegions } from '../src/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

type Ctx = Parameters<typeof transformHost>[2];
const ctx = {
	...HOST_CTX_DEFAULTS,
	root: '/app',
	libDir: '/app/src/lib',
	readFile: () => null,
	dev: false,
	virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	devUrlFor: (p: string) => `/@id/${p}`,
	visibleMargin: '0px',
	presets: {}
} as Ctx;

const host = (call: string) => dedent`
	<script>
	async function go() { return ${call}; }
	</script>
	<button onclick={go}>go</button>
`;
const ts = (call: string) => `export async function go() { return ${call}; }\n`;

/** The message code a compile threw, or 'ok' when it did not throw. */
function outcome(run: () => unknown): string {
	try {
		run();
		return 'ok';
	} catch (e) {
		return (e as { code?: string }).code ?? String(e);
	}
}
const in_host = (call: string) =>
	outcome(() => transformHost(host(call), '/app/src/routes/+page.svelte', ctx));
const in_ts = (call: string) =>
	outcome(() => transformTsRegions(ts(call), '/app/src/lib/x.ts', ctx));

const REFUSED = [
	`import('./C.svelte', { with: { wake: 'load' } })`,
	`import('./C.svelte', { with: { fetch: 'idle' } })`,
	`import('./C.svelte', { with: { render: 'deferred' } })`,
	`import('./C.svelte', { with: { preset: 'below' } })`,
	`import('./H.ts', { with: { region: 'held' } })`,
	`import('./C.svelte', { assert: { wake: 'load' } })`,
	`import('./C.svelte', { 'with': { 'wake': 'load' } })`,
	`import('./C.svelte', { ...base, with: { ...more, wake: 'load' } })`
];
const ALLOWED = [
	`import('./data.json', { with: { type: 'json' } })`,
	`import('./C.svelte')`,
	`import('./C.svelte', opts)`,
	`import('./C.svelte', { [key]: { wake: 'load' } })`,
	`import('./C.svelte', { with: { [key]: 'load' } })`,
	`import('./C.svelte', { other: { wake: 'load' } })`,
	`import('./C.svelte', { with: attrs })`
];

describe('dynamic import() with a region key', () => {
	it.each(REFUSED)('is refused in a .svelte host: %s', (call) => {
		expect(in_host(call)).toBe('dynamic_region_import');
	});
	it.each(REFUSED)('is refused in a .ts module: %s', (call) => {
		expect(in_ts(call)).toBe('dynamic_region_import');
	});
	it.each(ALLOWED)('is left alone when no region key is named: %s', (call) => {
		expect(in_host(call)).toBe('ok');
		expect(in_ts(call)).toBe('ok');
	});

	it('names each key once, in the order written', () => {
		let msg = '';
		try {
			transformHost(
				host(
					`import('./C.svelte', { with: { wake: 'load', fetch: 'idle' }, assert: { wake: 'idle' } })`
				),
				'/app/src/routes/+page.svelte',
				ctx
			);
		} catch (e) {
			msg = String(e);
		}
		expect(msg).toContain('{ with: { wake, fetch } }');
	});

	it('reads the configured key names', () => {
		const keys = { ...ctx, importKeys: { wake: 'hydrate' } } as Ctx;
		const call = `import('./C.svelte', { with: { hydrate: 'load' } })`;
		expect(outcome(() => transformHost(host(call), '/app/src/routes/+page.svelte', keys))).toBe(
			'dynamic_region_import'
		);
		expect(outcome(() => transformTsRegions(ts(call), '/app/src/lib/x.ts', keys))).toBe(
			'dynamic_region_import'
		);
	});

	it('a region import written in a comment or a string is not a call', () => {
		const src = dedent`
			// await import('./C.svelte', { with: { wake: 'load' } })
			export const sample = "import('./C.svelte', { with: { wake: 'load' } })";
		`;
		expect(outcome(() => transformTsRegions(src, '/app/src/lib/x.ts', ctx))).toBe('ok');
	});
});
