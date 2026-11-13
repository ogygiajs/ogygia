// What a template subtree reads from outside it, where a name is read without being a plain
// expression: a pattern's default (`{#each xs as { a = dflt }}`, a snippet parameter's
// `f = fmt`, `{@const { k = d } = o}`), a `{@debug}` tag, and a name a `catch` binds only inside
// its clause. A missed one is a ReferenceError when a portable snippet renders on the far side.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parse } from 'svelte/compiler';
import { dedent } from '@ogygia/core/contract';
import { collectFreeIdentifiers } from '../src/compiler/free-vars.ts';
import { transformHost } from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

const free = (markup: string) =>
	[...collectFreeIdentifiers(parse(markup, { modern: true }).fragment.nodes as never)].sort();

describe('collectFreeIdentifiers: names read by patterns, tags and clauses', () => {
	it.each([
		['{#each xs as { a = dflt }}{a}{/each}', ['dflt', 'xs']],
		['{#each xs as [a = dflt, { b: [c = more] }]}{a}{c}{/each}', ['dflt', 'more', 'xs']],
		['{#each xs as { [key]: v }}{v}{/each}', ['key', 'xs']],
		['{#snippet row(item, f = fmt)}{f(item)}{/snippet}', ['fmt']],
		['{#snippet row({ a = d })}{a}{/snippet}', ['d']],
		['{@const { k = d } = o}{k}', ['d', 'o']],
		['{#await p then { v = d }}{v}{/await}', ['d', 'p']],
		['{@debug x, y}', ['x', 'y']],
		['{(() => { try { f(); } catch (e) {} return e; })()}', ['e', 'f']],
		['{(() => { try { f(); } catch (e) { return e; } })()}', ['f']],
		['{(() => { try { f(); } catch ({ message = d }) { return message; } })()}', ['d', 'f']]
	])('%s → %j', (markup, want) => {
		expect(free(markup)).toEqual(want);
	});
});

describe('a portable snippet entry declares the names its patterns read', () => {
	const synth_of = (decl: string, body: string, head = 'children()') => {
		const src = dedent`
			<script>
			import Widget from './Widget.svelte' with { wake: 'load' };
			${decl}
			</script>
			<Widget>
				{#snippet ${head}}
					${body}
				{/snippet}
			</Widget>
		`;
		const out = transformHost(src, '/app/src/routes/x/+page.svelte', {
			...HOST_CTX_DEFAULTS,
			ssr: true,
			root: '/app',
			libDir: '/app/src/lib',
			readFile: () => null,
			dev: false,
			virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
			devUrlFor: (p: string) => p,
			visibleMargin: '0px',
			presets: {},
			pathModule: path
		} as Parameters<typeof transformHost>[2])!;
		return out.islands.map((i) => i.source ?? '').find((s) => s.includes('<script')) ?? '';
	};

	it('an each default from an import is imported', () => {
		expect(
			synth_of(
				`import { dflt } from './d.ts';\nconst xs = [{}];`,
				'{#each xs as { a = dflt }}{a}{/each}'
			)
		).toMatch(/import \{ dflt \} from '\.\/d\.ts'/);
	});

	it('a {@debug} name from the host is captured', () => {
		expect(synth_of(`let x = 1;`, '{@debug x}')).toMatch(/let \{ x \} = \$props\(\)/);
	});

	it("a default in the snippet's own parameters, from an import, is imported", () => {
		expect(synth_of(`import { fmt } from './f.ts';`, '{f(item)}', 'row(item, f = fmt)')).toMatch(
			/import \{ fmt \} from '\.\/f\.ts'/
		);
	});

	it("a pattern default in the snippet's own parameters, from the host, is captured", () => {
		expect(synth_of(`let d = 1;`, '{a}', 'row({ a = d })')).toMatch(
			/let \{ __ogArgs = \[\], d \} = \$props\(\)/
		);
	});

	it("a computed key in the snippet's own parameters, from the host, is captured", () => {
		expect(synth_of(`let key = 'a';`, '{v}', 'row({ [key]: v })')).toMatch(
			/let \{ __ogArgs = \[\], key \} = \$props\(\)/
		);
	});
});
