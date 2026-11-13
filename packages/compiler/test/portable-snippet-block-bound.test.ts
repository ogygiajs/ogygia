// A crossing snippet whose body reads a name a template block declares (an `{#each}` item, an
// `{#await}` value or error, an `{@const}`, an enclosing snippet's parameter or a nested snippet)
// stays a plain snippet: its own entry could not see the name and would read it as undefined.
// Beside it, the same body reading only host values does cross.
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

/** How many crossing snippets the host's markup mints. */
const crossing = (markup: string) => {
	const host = dedent`
		<script>
			import Widget from './Widget.svelte' with { wake: 'load' };
			const items = [1];
			const p = Promise.resolve({ v: 1 });
			const host_value = 1;
		</script>

		${markup}
	`;
	const islands = (transformHost(host, '/app/src/routes/+page.svelte', CTX)?.islands ?? []) as {
		portable?: boolean;
	}[];
	return islands.filter((i) => i.portable).length;
};

describe('a crossing snippet bound to a block name stays native', () => {
	it.each([
		[
			'an each item',
			'{#each items as item}<Widget>{#snippet top()}{item}{/snippet}</Widget>{/each}'
		],
		[
			'an each item destructured',
			'{#each items as { id, tags: [first] }}<Widget>{#snippet top()}{first}{/snippet}</Widget>{/each}'
		],
		[
			'an each index',
			'{#each items as item, i}<Widget>{#snippet top()}{i}{/snippet}</Widget>{/each}'
		],
		['an await value', '{#await p then v}<Widget>{#snippet top()}{v}{/snippet}</Widget>{/await}'],
		[
			'an await value destructured',
			'{#await p then { v }}<Widget>{#snippet top()}{v}{/snippet}</Widget>{/await}'
		],
		[
			'an await error',
			'{#await p}…{:catch e}<Widget>{#snippet top()}{e}{/snippet}</Widget>{/await}'
		],
		[
			'a const tag',
			'{#each items as item}{@const c = item}<Widget>{#snippet top()}{c}{/snippet}</Widget>{/each}'
		],
		[
			"an enclosing snippet's parameter",
			'{#snippet outer(x)}<Widget>{#snippet top()}{x}{/snippet}</Widget>{/snippet}{@render outer(1)}'
		],
		[
			'a snippet declared below the root',
			'{#if host_value}{#snippet inner()}<b>in</b>{/snippet}<Widget>{#snippet top()}{@render inner()}{/snippet}</Widget>{/if}'
		]
	])('%s', (_kind, markup) => {
		expect(crossing(markup)).toBe(0);
	});

	it.each([
		[
			'inside an each',
			'{#each items as item}<Widget>{#snippet top()}{host_value}{/snippet}</Widget>{/each}'
		],
		[
			'inside an await',
			'{#await p then v}<Widget>{#snippet top()}{host_value}{/snippet}</Widget>{/await}'
		],
		['at the root', '<Widget>{#snippet top()}{host_value}{/snippet}</Widget>']
	])('a body reading only host values crosses %s', (_where, markup) => {
		expect(crossing(markup)).toBe(1);
	});
});
