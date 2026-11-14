import { expect, it } from 'vitest';
import type { DevtoolsEvent } from '@ogygia/core/contract';
import { render_story } from '../src/mcp.ts';

const FP = 'abcdef0123456789';

const failed_run: DevtoolsEvent[] = [
	{
		domain: 'runtime',
		name: 'region.connected',
		fp: FP,
		entry: 'src/lib/Counter.svelte',
		wake: 'load',
		deferred: false,
		nested: false,
		v: 1,
		seq: 1,
		t: 10,
		realm: 'client'
	},
	{
		domain: 'runtime',
		name: 'region.hydrate.failed',
		fp: FP,
		entry: 'src/lib/Counter.svelte',
		message: 'count is not defined',
		v: 1,
		seq: 2,
		t: 20,
		realm: 'client'
	}
];

it('ogygia_debug: a failed hydration shows its reason in the region block and the warnings', () => {
	const story = render_story('http://localhost/', failed_run);
	expect(story).toContain('HYDRATION FAILED: count is not defined');
	expect(story).toContain(`#${FP.slice(0, 8)}: hydration failed — count is not defined.`);
});

it('ogygia_debug: a region seen only by its failure is named by that event’s entry', () => {
	const story = render_story('http://localhost/', [failed_run[1]]);
	expect(story).toContain('Counter.svelte');
	expect(story).toContain('HYDRATION FAILED: count is not defined');
});

it('ogygia_debug: the story header lists the features the runtime booted (#1813)', () => {
	const boot: DevtoolsEvent = {
		domain: 'runtime',
		name: 'runtime.boot',
		features: ['router', 'context'],
		v: 1,
		seq: 0,
		t: 5,
		realm: 'client'
	};
	const story = render_story('http://localhost/', [boot, ...failed_run]);
	expect(story).toContain('runtime booted (router, context)');
});

const applied = (endpoint: string, seq: number, revalidate = false): DevtoolsEvent => ({
	domain: 'runtime',
	name: 'region.server.applied',
	entry: 'src/lib/Greeting.svelte',
	endpoint,
	bytes: 120,
	revalidate,
	...(revalidate ? {} : { wait_ms: 40 }),
	v: 1,
	seq,
	t: 30 + seq,
	realm: 'client'
});

it('ogygia_debug: each applied hole has its own block, keyed by its endpoint (#1820)', () => {
	const story = render_story('http://localhost/', [
		...failed_run,
		applied('/__ogygia__/r?id=a', 3),
		applied('/__ogygia__/r?id=b', 4),
		applied('/__ogygia__/r?id=a', 5, true)
	]);
	expect(story).toContain('2 hole(s)');
	expect(story.split('deferred HTML applied (120 B').length - 1).toBe(2);
	expect(story).toContain('Greeting.svelte');
	expect(story).toContain('re-applied 1 time(s)');
});
