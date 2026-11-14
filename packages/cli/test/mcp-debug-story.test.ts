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
