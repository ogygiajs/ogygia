// The shipped component check (./shipped-svelte.ts): a component in TypeScript that compiles as
// shipped has no finding; each broken rule is named by its line.
// Run by plain node: `node --test internal/checks/shipped-svelte.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedent } from '@ogygia/core/plugin/utils';
import {
	as_shipped,
	compile_findings,
	find_all,
	PENDING,
	shipped_components,
	source_findings
} from './shipped-svelte.ts';

const clean = dedent`
	<script lang="ts">
		import type { Snippet } from 'svelte';
		interface Props {
			/** what the row shows */
			label: string;
			row?: Snippet<[number]>;
		}
		let { label, row }: Props = $props();
		const tag = '<sty' + 'le>';
	</script>

	{#snippet item(n: number)}<b>{n as number}</b>{/snippet}
	<p>{label!}{tag}</p>{@render (row ?? item)(1)}
`;

test('a TypeScript component with only descriptions in its JSDoc has no finding', async () => {
	assert.deepEqual(source_findings(clean, 'Clean.svelte'), []);
	assert.deepEqual(compile_findings(await as_shipped(clean, 'Clean.svelte'), 'Clean.svelte'), []);
});

test('a script without lang="ts" is named, the module script too', () => {
	const source = dedent`
		<script module>
			export const a = 1;
		</script>
		<script lang="ts">
			let b = 2;
		</script>
	`;
	assert.deepEqual(source_findings(source, 'X.svelte'), ['1: a <script> without lang="ts"']);
});

test('each JSDoc type tag is named by its line, in the script or the markup', () => {
	const source = dedent`
		<script lang="ts">
			/** @type {string} */
			let a = '';
			/**
			 * Adds one.
			 * @param {number} n
			 */
			const inc = (n: number) => n + 1;
		</script>

		<p>{/** @type {string} */ (a)}{inc(1)}</p>
	`;
	assert.deepEqual(source_findings(source, 'X.svelte'), [
		'2: a JSDoc type tag (write the type in TypeScript)',
		'4: a JSDoc type tag (write the type in TypeScript)',
		'11: a JSDoc type tag (write the type in TypeScript)'
	]);
});

test('a @param with no type, only its description, is not a type tag', () => {
	const source = dedent`
		<script lang="ts">
			/** @param n how many */
			const inc = (n: number) => n + 1;
		</script>
	`;
	assert.deepEqual(source_findings(source, 'X.svelte'), []);
});

test('a <style> literal inside a script is named, in a comment too', () => {
	const in_comment = dedent`
		<script lang="ts">
			// the body brings its own <style>
		</script>
	`;
	const closing = dedent`
		<script lang="ts">
			const css = '</style>';
		</script>
	`;
	assert.deepEqual(source_findings(in_comment, 'X.svelte'), [
		'2: a <style> literal inside a <script>'
	]);
	assert.deepEqual(source_findings(closing, 'X.svelte'), [
		'2: a <style> literal inside a <script>'
	]);
});

test('markup TypeScript the plain-JS consumer cannot compile fails before the strip, passes after it', async () => {
	const source = dedent`
		<script lang="ts">
			let meta: { runs?: number[] } = $state({ runs: [1] });
		</script>

		<p>{meta.runs!.length}</p>
	`;
	const script_only = source.replace(' lang="ts"', '').replace(': { runs?: number[] }', '');
	assert.equal(compile_findings(script_only, 'X.svelte').length, 2);
	assert.deepEqual(compile_findings(await as_shipped(source, 'X.svelte'), 'X.svelte'), []);
});

test('a top-level await compiles in async mode', async () => {
	const source = dedent`
		<script lang="ts">
			const n: number = await Promise.resolve(1);
		</script>

		<p>{n}</p>
	`;
	assert.deepEqual(compile_findings(await as_shipped(source, 'X.svelte'), 'X.svelte'), []);
});

test('the shipped components are every package src component, and nothing else', () => {
	const files = shipped_components();
	assert.ok(files.includes('packages/core/src/Region.svelte'));
	assert.ok(files.includes('packages/content/src/Blocks.svelte'));
	assert.ok(files.includes('packages/devtools/src/profiler/ui/Report.svelte'));
	assert.ok(files.every((f) => /^packages\/[^/]+\/src\//.test(f)));
	for (const pending of PENDING) assert.ok(files.includes(pending), pending);
});

test('every shipped component passes', async () => {
	assert.deepEqual(await find_all(), []);
});
