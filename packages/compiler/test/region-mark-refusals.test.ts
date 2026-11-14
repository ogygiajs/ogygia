// A region mark the compiler cannot honor is a build error that says what to write instead.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { dedent } from '@ogygia/core/contract';
import {
	normalize_import_keys,
	transformHost,
	transformTsRegions,
	wrapperVirtualId
} from '../src/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

type Ctx = Parameters<typeof transformHost>[2];
type TsCtx = Parameters<typeof transformTsRegions>[2];

const ctx = (presets: Record<string, Record<string, unknown>> = {}): Ctx =>
	({
		...HOST_CTX_DEFAULTS,
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_host: string, iid: string) => wrapperVirtualId(iid),
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets,
		pathModule: path
	}) as Ctx;

const TS_CTX: TsCtx = {
	root: '/app',
	libDir: '/app/src/lib',
	dev: false,
	virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	devUrlFor: (p: string) => `/@id/${p}`,
	importKeys: undefined,
	visibleMargin: '0px'
};

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (e) {
		return `${(e as { code?: string }).code ?? ''} ${(e as Error).message}`;
	}
	return 'not refused';
}

const mark = (attrs: string, presets?: Record<string, Record<string, unknown>>) =>
	refusal(() =>
		transformHost(
			dedent`
				<script>
				import C from './C.svelte' with { ${attrs} };
				</script>
				<C />
			`,
			'/app/src/routes/+page.svelte',
			ctx(presets)
		)
	);

describe('a region mark refused', () => {
	it('a preset beside another attribute', () => {
		expect(mark(`preset: 'p', margin: '10px'`, { p: { wake: 'visible' } })).toMatch(
			/`preset` must be the only import attribute/
		);
	});

	it('a marked import with no specifier in a .ts module', () => {
		expect(
			refusal(() =>
				transformTsRegions(
					`import X from '' with { wake: 'load' };\nexport { X };`,
					'/app/src/lib/r.ts',
					TS_CTX
				)
			)
		).toMatch(/^region_import_no_specifier /);
	});

	it('an import key that is no JavaScript name', () => {
		expect(refusal(() => normalize_import_keys({ wake: 'not a name' }))).toMatch(
			/^import_key_invalid /
		);
	});
});
