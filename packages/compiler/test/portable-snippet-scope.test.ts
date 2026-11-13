// Every name a crossing snippet's body reads must reach its synth entry. A name the transform could not
// place was taken for a global, and the synth threw `ReferenceError: <name> is not defined` at render
// (every request a 500 — a product page whose live snippets rendered a shared template-root snippet).
// The kinds: a template-ROOT snippet (and the root snippets it renders), a `<script module>` import or
// value, an `export`ed instance declaration, a legacy `$:` declaration. A legacy `let:` slot prop binds
// its children's scope, so a body reading one stays a plain snippet.
import { describe, it, expect } from 'vitest';
import { compile } from 'svelte/compiler';
import { transformHost } from '../src/compiler/region/transform.ts';

const ctx = {
	root: '/app',
	libDir: '/app/src/lib',
	readFile: () => null,
	dev: false,
	virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	wrapperPathFor: (_h: string, iid: string) => `ogygia:region/wrapper/${iid}.svelte`,
	devUrlFor: (p: string) => p,
	visibleMargin: '200px',
	presets: {},
	importKeys: {},
	idSalt: '',
	clientBindingStub: 'ogygia:region/client-binding-stub',
	routeCsr: undefined,
	linkVirtualIsland: true
};

type Island = { source?: string; portable?: boolean };
const synths = (host: string) =>
	(
		(transformHost(host, '/app/src/routes/+page.svelte', { ...ctx, ssr: true })?.islands ??
			[]) as Island[]
	)
		.filter((i) => i.portable)
		.map((i) => i.source!);

/** The synth compiles on its own: every name it reads is declared in it (Svelte reports the rest). */
const compiles = (synth: string) => {
	const r = compile(synth, { generate: 'server', filename: 'synth.svelte' });
	return (
		r.warnings.filter((w) => w.code === 'export_let_unused' || w.message.includes('not defined'))
			.length === 0
	);
};

describe('portable snippet — every name its body reads reaches the synth', () => {
	it('carries a template-root snippet (parameterized, using an import and a host value) and those it renders', () => {
		const [top, middle] = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
	import Badge from './Badge.svelte';
	const data = { label: 'sale' };
</script>

{#snippet banner(position)}<p>{data.label} {position} {@render mark()}</p>{/snippet}
{#snippet mark()}<Badge />{/snippet}

<Widget>
	{#snippet top()}{@render banner('top')}{/snippet}
	{#snippet middle()}{@render banner('middle')}{/snippet}
</Widget>
`);
		expect(top, 'one synth per crossing snippet').toBeTruthy();
		for (const synth of [top, middle]) {
			expect(synth).toContain('{#snippet banner(position)}');
			expect(synth).toContain('{#snippet mark()}');
			expect(synth).toContain("import Badge from './Badge.svelte'");
			expect(synth).toMatch(/let \{[^}]*\bdata\b[^}]*\} = \$props\(\)/);
			expect(compiles(synth), synth).toBe(true);
		}
	});

	it('re-imports a <script module> import and captures a <script module> value', () => {
		const [synth] = synths(`<script module>
	import Badge from './Badge.svelte';
	const START = 600;
</script>
<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
</script>

<Widget>{#snippet blocks()}<Badge n={START} />{/snippet}</Widget>
`);
		expect(synth).toContain("import Badge from './Badge.svelte'");
		expect(synth).toMatch(/let \{[^}]*\bSTART\b[^}]*\} = \$props\(\)/);
		expect(compiles(synth), synth).toBe(true);
	});

	it('captures an exported instance declaration', () => {
		const [synth] = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
	export const label = 'x';
</script>

<Widget>{#snippet blocks()}<p>{label}</p>{/snippet}</Widget>
`);
		expect(synth).toMatch(/let \{[^}]*\blabel\b[^}]*\} = \$props\(\)/);
	});

	it('captures a host name read after a class whose static block declares the same name (#1634)', () => {
		const [synth] = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
	let d = 1;
</script>

<Widget>{#snippet blocks()}<p>{(() => { class K { static { const d = 2; } } return d; })()}</p>{/snippet}</Widget>
`);
		expect(synth).toMatch(/let \{[^}]*\bd\b[^}]*\} = \$props\(\)/);
	});

	it('captures a host name a legacy `let:` default reads inside the snippet (#1633)', () => {
		const [synth] = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
	import List from './List.svelte';
	let d = 1;
</script>

<Widget>{#snippet blocks()}<List let:item={[a = d]}><p>{a}</p></List>{/snippet}</Widget>
`);
		expect(synth).toMatch(/let \{[^}]*\bd\b[^}]*\} = \$props\(\)/);
	});

	it('captures a legacy `$:` declaration', () => {
		const [synth] = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
	let n = 1;
	$: doubled = n * 2;
</script>

<Widget>{#snippet blocks()}<p>{doubled}</p>{/snippet}</Widget>
`);
		expect(synth).toMatch(/let \{[^}]*\bdoubled\b[^}]*\} = \$props\(\)/);
	});

	it('leaves a body reading a legacy `let:` slot prop a plain snippet (no synth)', () => {
		const out = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
	import List from './List.svelte';
</script>

<List let:item>
	<Widget>{#snippet blocks()}<p>{item}</p>{/snippet}</Widget>
</List>
`);
		expect(out).toEqual([]);
	});

	it('leaves a body reading a destructured legacy `let:` slot prop a plain snippet (no synth)', () => {
		for (const directive of [
			'let:item={{ id }}',
			'let:item={{ x: id }}',
			'let:item={[id]}',
			'let:item={{ ...id }}'
		]) {
			const out = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
	import List from './List.svelte';
</script>

<List ${directive}>
	<Widget>{#snippet blocks()}<p>{id}</p>{/snippet}</Widget>
</List>
`);
			expect(out, directive).toEqual([]);
		}
	});

	it('a root snippet that writes host state keeps the body native', () => {
		const out = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
	let n = $state(0);
</script>

{#snippet bump()}<button onclick={() => n++}>{n}</button>{/snippet}

<Widget>{#snippet blocks()}{@render bump()}{/snippet}</Widget>
`);
		expect(out).toEqual([]);
	});

	it('a snippet that writes only its own parameter crosses; one that writes host state stays native', () => {
		const own = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
</script>

<Widget>{#snippet row(item)}<button onclick={() => { item = { n: 1 }; item.n++; }}>x</button>{/snippet}</Widget>
`);
		expect(own).toHaveLength(1);
		const host = synths(`<script>
	import Widget from './Widget.svelte' with { wake: 'load' };
	let n = $state(0);
</script>

<Widget>{#snippet row(item)}<button onclick={() => n++}>{item}{n}</button>{/snippet}</Widget>
`);
		expect(host).toEqual([]);
	});
});
