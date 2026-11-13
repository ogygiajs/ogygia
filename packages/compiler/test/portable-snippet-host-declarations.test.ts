// A crossing snippet that reads a host value gets it as a prop of its synth. Every way the host
// `<script>` can declare the name counts: a destructuring of any shape, a function, a class, an
// export. A name the transform missed was taken for a global, and the synth threw
// `ReferenceError` at render (see portable-snippet-scope.test.ts for the other kinds).
import { describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import { transformHost } from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

type Ctx = Parameters<typeof transformHost>[2];
const CTX = {
	...HOST_CTX_DEFAULTS,
	ssr: true,
	root: '/app',
	libDir: '/app/src/lib',
	readFile: () => null,
	dev: false,
	virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	devUrlFor: (p: string) => p,
	visibleMargin: '0px',
	presets: {}
} as Ctx;

const synth_props = (declaration: string) => {
	const host = dedent`
		<script>
			import Widget from './Widget.svelte' with { wake: 'load' };
			const obj = { a: 1, k: 2 };
			const arr = [1];
			${declaration}
		</script>

		<Widget>
			{#snippet top()}<p>{a}</p>{/snippet}
		</Widget>
	`;
	const islands = (transformHost(host, '/app/src/routes/+page.svelte', CTX)?.islands ?? []) as {
		portable?: boolean;
		source?: string;
	}[];
	const synth = islands.find((i) => i.portable)?.source ?? '';
	return synth.match(/let \{([^}]*)\} = \$props\(\)/)?.[1].trim() ?? null;
};

describe('a host value a crossing snippet reads reaches its synth', () => {
	it.each([
		'const { a } = obj;',
		'const { k: a } = obj;',
		'const { a = 1 } = obj;',
		'const { ...a } = obj;',
		'const [a] = arr;',
		'const [a = 1] = arr;',
		'const [...a] = arr;',
		'const [[a]] = [arr];',
		'function a() { return 1; }',
		'class a {}',
		'export const a = 1;',
		'let a = 1;'
	])('%s', (declaration) => {
		expect(synth_props(declaration)).toBe('a');
	});
});
