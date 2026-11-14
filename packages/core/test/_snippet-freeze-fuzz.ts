/**
 * THE SNIPPET FREEZE, OLD AGAINST NEW. A bare snippet froze through a hand-written server component
 * (Svelte's private `($$renderer, $$props)` shape); it now freezes through `RenderSnippet.svelte`
 * (`{@render snippet()}`), rendered by `svelte/server`'s public `render()`. Random snippets are
 * compiled here, in dev and prod, and rendered both ways: the body and the head must be the same
 * bytes, but for the one known difference, the empty marker Svelte writes after a `{@render}`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
// @ts-expect-error -- Svelte ships no types for the internals its compiled server code imports; the fuzz hands them to that code
import * as $ from 'svelte/internal/server';
import type { Component, Snippet } from 'svelte';
import { fc, sim_params } from '@ogygia/config/sim';
import { region } from '../src/region.ts';

/** What Svelte writes after a `{@render}` tag: the one byte difference the new path is allowed. */
export const RENDER_ANCHOR = '<!---->';
/** How `render()` closes its root block, after which nothing of the snippet is written. */
const ROOT_CLOSE = '<!--]-->';

type Renderer = { component(fn: (r: Renderer) => void, of: unknown): void };

/** The old path, as region-snippet.ts wrote it before: a hand-written server component. */
const OldRenderSnippet = (($$renderer: Renderer, $$props: { s: Snippet }) => {
	$$renderer.component(($$renderer) => {
		($$props.s as unknown as (r: Renderer) => void)($$renderer);
	}, OldRenderSnippet);
}) as unknown as Component<{ s: Snippet }>;

const RENDER_SNIPPET_SOURCE = fs.readFileSync(
	path.join(import.meta.dirname, '../src/RenderSnippet.svelte'),
	'utf8'
);

const CHILD_SOURCE = `<script>
	let { title = '', children } = $props();
</script>

<svelte:head><meta name="child" content={title} /></svelte:head>

<span class="child" {title}>{@render children?.()}</span>

<style>
	.child { margin: 1px; }
</style>`;

/** Svelte's server output for `source`, made a module of this process (its imports handed in). */
class Compiled {
	/** `source` compiled as `<name>.svelte`: its default export (the component, named `name` by
	 *  Svelte) and its module exports. `imports` stand in for its own `import X from 'X'` lines. */
	static module(
		name: string,
		source: string,
		options: { dev: boolean; async: boolean },
		imports: Record<string, unknown> = {}
	): { component: Component<Record<string, unknown>>; exports: Record<string, unknown> } {
		const { js } = compile(source, {
			generate: 'server',
			dev: options.dev,
			css: 'injected',
			filename: `${name}.svelte`,
			experimental: { async: options.async }
		});
		const names = Object.keys(imports);
		const code = js.code
			.replace(/^import \* as \$ from 'svelte\/internal\/server';$/m, '')
			.replace(/^import 'svelte\/internal\/flags\/async';$/m, '')
			.replace(/^import \w+ from '\w+';$/gm, '')
			.replace(/^export \{ ([\w, ]+) \};$/m, 'const __exports = { $1 };')
			.replace(/^export default function /m, 'function ')
			.replace(/^export default \w+;$/m, '');
		// oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- runs the code Svelte compiled from a generated snippet, the point of the fuzz
		const run = new Function(
			'$',
			...names,
			`${code}\nreturn { component: ${name}, exports: typeof __exports === 'undefined' ? {} : __exports };`
		);
		return run($, ...names.map((n) => imports[n])) as ReturnType<typeof Compiled.module>;
	}
}

const word = fc.constantFrom('a', 'hello', 'x y', '0', '');
const odd_text = fc.constantFrom(
	'</script>',
	'<!--',
	'-->',
	'"',
	"'",
	'é',
	'😀',
	' ',
	'&amp;',
	'<b>',
	'{}',
	'`${x}`',
	'\\'
);
const str = fc.oneof(word, odd_text);
const js_str = str.map((s) => JSON.stringify(s));
const tag = fc.constantFrom('span', 'b', 'em', 'strong', 'u', 'i');
const class_name = fc.constantFrom('x', 'y', 'unused-class');

const attrs = fc
	.array(
		fc.oneof(
			class_name.map((c) => `class="${c}"`),
			js_str.map((s) => `title={${s}}`),
			word.map((w) => `data-w="${w.replace(/"/g, '')}"`),
			fc.constant('hidden')
		),
		{ maxLength: 3 }
	)
	.map((a) =>
		[...new Set(a.map((x) => x.split('=')[0]))]
			.map((k) => a.find((x) => x.startsWith(k!))!)
			.join(' ')
	);

/** A snippet's parameter list, and the tags that read its parameters (none reads an undeclared one). */
const PARAMS: ReadonlyArray<readonly [string, readonly string[]]> = [
	['', []],
	['a', ['{a}', "{a ?? 'none'}", '{typeof a}']],
	['a, b', ['{a}', '{String(b)}', '{a === b}']],
	['a = null', ['{a === null}', '{String(a)}']],
	['a = undefined, b = null', ['{String(a)}', '{b === null}']]
];

const node_of = (uses: readonly string[]): fc.Arbitrary<string> =>
	fc.letrec<{ node: string; nodes: string }>((tie) => ({
		node: fc.oneof(
			{ depthSize: 'small', withCrossShrink: true },
			word,
			js_str.map((s) => `{${s}}`),
			uses.length ? fc.constantFrom(...uses) : word,
			fc.constant('<br />'),
			js_str.map((s) => `<img alt={${s}} />`),
			fc.tuple(tag, attrs, tie('nodes')).map(([t, a, c]) => `<${t} ${a}>${c}</${t}>`),
			fc
				.tuple(fc.boolean(), tie('nodes'), tie('nodes'))
				.map(([b, y, n]) => `{#if ${b}}${y}{:else}${n}{/if}`),
			fc
				.tuple(fc.array(js_str, { maxLength: 3 }), tie('nodes'))
				.map(([items, c]) => `{#each [${items.join(', ')}] as item, i}{item}{i}${c}{/each}`),
			fc
				.tuple(js_str, tie('nodes'))
				.map(([v, c]) => `{#await Promise.resolve(${v})}${c}{:then v}{v}{/await}`),
			js_str.map((s) => `{@render inner(${s})}`),
			fc.tuple(js_str, tie('nodes')).map(([s, c]) => `<Child title={${s}}>${c}</Child>`),
			fc.constant('<Child />')
		),
		nodes: fc.array(tie('node'), { maxLength: 3 }).map((n) => n.join(''))
	})).node;

const host = fc
	.constantFrom(...PARAMS)
	.chain(([p, uses]) =>
		fc.array(node_of(uses), { minLength: 1, maxLength: 4 }).map((body) => [p, body] as const)
	)
	.map(
		([p, body]) => `<script module>
	import Child from 'Child';
	export { s };
</script>

{#snippet inner(x)}<i class="x">{x}</i>{/snippet}
{#snippet s(${p})}${body.join('')}{/snippet}

<style>
	.x { color: red; }
	.y { color: blue; }
</style>`
	);

type Rendered = { body: string; head: string };
const rendered = (out: { body: string; head: string }): Rendered => ({
	body: out.body,
	head: out.head
});

/** The fuzz, in the Svelte mode this process runs (`async`: the async flag was imported first). */
export function snippet_freeze_fuzz(async: boolean, seed: number): void {
	it.each([false, true])(
		`a random snippet renders the same bytes old and new but the one render anchor (async ${async}, dev %s)`,
		(dev) => {
			const options = { dev, async };
			const NewRenderSnippet = Compiled.module(
				'RenderSnippet',
				RENDER_SNIPPET_SOURCE,
				options
			).component;
			const Child = Compiled.module('Child', CHILD_SOURCE, options).component;
			const seen = { rendered: 0, threw: 0, with_head: 0 };
			fc.assert(
				fc.property(host, (source) => {
					const { s } = Compiled.module('Fuzz', source, options, { Child }).exports as {
						s: Snippet;
					};
					let before: Rendered;
					try {
						before = rendered(render(OldRenderSnippet, { props: { s } }));
						seen.rendered++;
						if (before.head) seen.with_head++;
					} catch (e) {
						seen.threw++;
						let thrown: unknown = null;
						try {
							render(NewRenderSnippet, { props: { snippet: s } });
						} catch (e2) {
							thrown = e2;
						}
						expect(String(thrown)).toBe(String(e));
						return;
					}
					const after = rendered(render(NewRenderSnippet, { props: { snippet: s } }));
					expect(after.head).toBe(before.head);
					expect(before.body.endsWith(ROOT_CLOSE)).toBe(true);
					const at = before.body.lastIndexOf(ROOT_CLOSE);
					expect(after.body).toBe(before.body.slice(0, at) + RENDER_ANCHOR + before.body.slice(at));
				}),
				sim_params({ runs: 1500, seed })
			);
			expect(seen.threw, 'the generator writes snippets that render').toBe(0);
			expect(seen.with_head, 'some snippets write head content').toBeGreaterThan(
				seen.rendered / 10
			);
		},
		60_000
	);

	it(`region.snippet() freezes through RenderSnippet.svelte (async ${async})`, () => {
		const options = { dev: true, async };
		const Child = Compiled.module('Child', CHILD_SOURCE, options).component;
		fc.assert(
			fc.property(host, (source) => {
				const { s } = Compiled.module('Fuzz', source, options, { Child }).exports as {
					s: Snippet;
				};
				let before: string;
				try {
					before = render(OldRenderSnippet, { props: { s } }).body;
				} catch {
					return;
				}
				const at = before.lastIndexOf(ROOT_CLOSE);
				expect((region.snippet(s) as { __ogRegion?: unknown }).__ogRegion).toEqual({
					m: 'static',
					h: before.slice(0, at) + RENDER_ANCHOR + before.slice(at)
				});
			}),
			sim_params({ runs: 300, seed })
		);
	}, 60_000);
}
