import { describe, expect, it } from 'vitest';
import { hydration_hazards } from '@ogygia/insights';
import { hazard_fix, hazard_words } from '../src/profiler/report.ts';
import { dedent } from '@ogygia/core/plugin/utils';

describe('the report says them', () => {
	it('each line by file and line, with what it does; the fix per kind', () => {
		const lines = [
			{
				file: 'src/lib/Clock.svelte',
				line: 3,
				code: "const where = typeof window === 'undefined' ? 'server' : 'browser';",
				kind: 'browser' as const,
				reads: 'typeof window'
			},
			{
				file: 'src/lib/Nav.svelte',
				line: 9,
				code: 'const tree = await nav();',
				kind: 'await' as const
			}
		];
		expect(hazard_words(lines)).toBe(
			"In its own code, the likeliest: Clock.svelte:3 (`const where = typeof window === 'undefined' ? 'server' : 'browser';`) reads typeof window while rendering, a value the server does not have; Nav.svelte:9 (`const tree = await nav();`) awaits at the top of its script: the browser runs it again, and another answer draws another tree."
		);
		expect(hazard_fix(lines)).toContain('Give both sides the same answer');
		expect(hazard_fix(lines)).toContain('Read the browser-only value after the wake');
	});
});

describe('hydration_hazards: the lines that draw differently in the browser', () => {
	it('a top-level await, a browser value in a derived and in the markup', () => {
		const src = dedent`
			<script lang="ts">
				import { page } from '$app/state';
				let { site, nav } = $props();
				const fetched = nav ? [] : await site.nav();
				const top_href = $derived(typeof window !== 'undefined' ? window.location.pathname : '/');
			</script>

			<p>Built {Date.now()}</p>
			<a href={top_href}>top</a>
		`;
		expect(hydration_hazards(src)).toEqual([
			{ line: 4, code: 'const fetched = nav ? [] : await site.nav();', kind: 'await' },
			{
				line: 5,
				code: "const top_href = $derived(typeof window !== 'undefined' ? window.location.pathname : '/');",
				kind: 'browser',
				reads: 'typeof window'
			},
			{ line: 8, code: '<p>Built {Date.now()}</p>', kind: 'browser', reads: 'Date.now(' }
		]);
	});

	it('a top-level `if (typeof window …)` is a guard: a lead, marked, not a prediction', () => {
		const src = dedent`
			<script>
				if (typeof window !== 'undefined') {
					work();
				}
			</script>
			<p>same</p>
		`;
		expect(hydration_hazards(src)).toEqual([
			{
				line: 2,
				code: "if (typeof window !== 'undefined') {",
				kind: 'browser',
				reads: 'typeof window',
				guard: true
			}
		]);
	});

	it('what runs after the wake is never one: callbacks, effects, handlers, the module script', () => {
		const src = dedent`
			<script module>
				const started = Date.now();
			</script>
			<script>
				import { onMount } from 'svelte';
				let w = $state(0);
				onMount(() => {
					w = window.innerWidth;
				});
				$effect(() => {
					document.title = \`x\`;
				});
				function go() {
					window.scrollTo(0, 0);
				}
				const load = async () => {
					await fetch(\`/x\`);
				};
				const reduced = () =>
					typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
			</script>
			<button onclick={() => window.scrollTo(0, 0)}>top {w}</button>
			<p>{mywindow.size}</p>
		`;
		expect(hydration_hazards(src)).toEqual([]);
	});
});
