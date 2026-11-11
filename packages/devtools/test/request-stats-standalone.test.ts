/**
 * A PROFILER USED ON ITS OWN (#805): `profiler()` without the devtools plugin (and the one
 * `ogygia.handle()` builds) gets the request stats too. Core's handle writes into the sink it was
 * given; the profiler's store must be that sink once any profiler is live, or a recording keeps no
 * per-island rows and a batch's holes are never handed on.
 */
import { describe, expect, it, vi } from 'vitest';

const installed = vi.hoisted(() => ({ sink: null as unknown }));
vi.mock(import('@ogygia/core/internal/server'), async (original) => {
	const core = await original();
	return {
		...core,
		set_request_stats_sink: (next) => {
			installed.sink = next;
			core.set_request_stats_sink(next);
		}
	};
});

const { profiler } = await import('../src/profiler/index.ts');
const { request_stats_store } = await import('../src/profiler/request-stats.ts');

describe('a standalone profiler', () => {
	it('hands core its request-stats store, so recordings keep per-island rows and batch holes', () => {
		expect(installed.sink).toBeNull();
		profiler({ secret: 'standalone-profiler-key' });
		expect(installed.sink).toBe(request_stats_store);
		// what core's handle asks before it hands a batch's holes on
		expect(request_stats_store.wantsBatchHoles()).toBe(true);
	});
});
