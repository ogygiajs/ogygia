// The shipped component check (./shipped-svelte.ts): a component in TypeScript that compiles as
// shipped has no finding; each broken rule is named by its line.
// Run by plain node: `node --test internal/checks/shipped-svelte.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dedent } from '@ogygia/core/plugin/utils';
import {
	as_shipped,
	CLEAN_PACKAGES,
	compile_findings,
	find_all,
	MARKUP_FREE,
	MARKUP_WHY,
	markup_findings,
	pending_markup,
	ROOT,
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

const IN_CORE = path.join(ROOT, 'packages/core/src/X.svelte');
const REAL_TEST = '(test: internal/checks/shipped-svelte.test.ts › every shipped component passes)';

test('a markup comment is a tool directive, the @component doc or a tested @why; any other is named by its line', () => {
	const source = dedent`
		<!-- @component What the region shows. -->
		<script lang="ts">
			let open = $state(false);
		</script>

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div onclick={() => (open = !open)}></div>
		<!-- prettier-ignore -->
		<pre>  a  </pre>
		<!-- the panel opens on a click -->
		<p>{open}</p>
		<!--
			two lines
			of prose
		-->
		<p></p>
	`;
	assert.deepEqual(markup_findings(source, IN_CORE), [`10: ${MARKUP_FREE}`, `12: ${MARKUP_FREE}`]);
});

test('an @component doc passes only at the top level of the markup', () => {
	const source = dedent`
		<!-- @component The doc. -->
		<div>
			<!-- @component Not the doc. -->
			<p></p>
		</div>
	`;
	assert.deepEqual(markup_findings(source, IN_CORE), [`3: ${MARKUP_FREE}`]);
});

test('a markup @why passes only on its own line above its element, and when its test exists', () => {
	const source = dedent`
		<!-- @why Safari fires it twice ${REAL_TEST} -->
		<p></p>
		<!-- @why Safari fires it twice (test: internal/checks/nul-bytes.test.ts › no such test) -->
		<p></p>
		<!-- @why no test named -->
		<p></p>
		<!-- @why Safari fires it twice ${REAL_TEST} -->

		<p></p>
		<p></p><!-- @why Safari fires it twice ${REAL_TEST} -->
		<p></p>
	`;
	assert.deepEqual(markup_findings(source, IN_CORE), [
		`3: ${MARKUP_WHY}`,
		`5: ${MARKUP_WHY}`,
		`7: ${MARKUP_WHY}`,
		`10: ${MARKUP_WHY}`
	]);
});

test('a markup comment fails the check only in a clean package; the others are counted as pending', async () => {
	const pending = await pending_markup();
	for (const pkg of CLEAN_PACKAGES) assert.equal(pending.get(pkg), undefined, pkg);
	const found = await find_all();
	assert.ok(found.every((f) => !f.includes(MARKUP_FREE)));
});

test("each clean package's components hold the structured-comments rule as an error, script and markup", () => {
	const config = JSON.parse(readFileSync(path.join(ROOT, '.oxlintrc.json'), 'utf8')) as {
		overrides: { files: string[]; rules: Record<string, unknown> }[];
	};
	const as_error = new Set(
		config.overrides
			.filter((o) => o.rules['ogygia/structured-comments'] === 'error')
			.flatMap((o) => o.files)
	);
	for (const pkg of CLEAN_PACKAGES)
		assert.ok(
			as_error.has(`packages/${pkg}/src/**/*.svelte`) || as_error.has(`packages/${pkg}/src/**`),
			pkg
		);
});

test('the shipped components are every package src component, and nothing else', () => {
	const files = shipped_components();
	assert.ok(files.includes('packages/core/src/Region.svelte'));
	assert.ok(files.includes('packages/content/src/Blocks.svelte'));
	assert.ok(files.includes('packages/devtools/src/profiler/ui/Report.svelte'));
	assert.ok(files.includes('packages/router/src/LayoutChain.svelte'));
	assert.ok(files.every((f) => /^packages\/[^/]+\/src\//.test(f)));
});

test('every shipped component passes', async () => {
	assert.deepEqual(await find_all(), []);
});
