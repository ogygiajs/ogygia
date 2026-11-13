/**
 * The report's small pure readers: contention over the request ring, the render's steps, range
 * queries over the stack index, the markup diff's tokens, the client asset path and the redirect
 * stub.
 */
import { describe, expect, it } from 'vitest';
import { islands_endpoint } from '@ogygia/core/internal/server';
import { contention } from '../src/profiler/contention.ts';
import { render_steps } from '../src/profiler/steps.ts';
import { range_hot } from '../src/profiler/stacks.ts';
import { html_diff } from '../src/profiler/dom-diff.ts';
import { app_asset_rel } from '../src/profiler/client-files.ts';
import { refresh_target } from '../src/profiler/refresh-stub.ts';
import type { RequestEntry } from '../src/profiler/report.ts';
import type { Segment, Timeline } from '../src/profiler/timeline.ts';
import type { StackIndex } from '../src/profiler/analyze.ts';

const entry = (path: string, pt: number, ms: number, cpu_ms: number): RequestEntry =>
	({
		ts: 0,
		method: 'GET',
		path,
		route: null,
		status: 200,
		ms,
		cpu_ms,
		inflight: 0,
		net_ms: 0,
		net_count: 0,
		pt
	}) as RequestEntry;

describe('contention', () => {
	const windows = [{ start: 0, end: 100 }];

	it("caps a request's CPU at its overlap with the window", () => {
		const c = contention({ requests: [entry('/x', 50, 100, 400)], windows })!;
		expect(c.requests[0]).toMatchObject({ overlap_ms: 50, cpu_max_ms: 50 });
	});

	it('the busy share counts two requests over the same time once', () => {
		const c = contention({
			requests: [entry('/a', 0, 50, 0), entry('/b', 0, 50, 0)],
			windows
		})!;
		expect(c.overlap_ms).toBe(100);
		expect(c.busy_share).toBe(0.5);
	});

	it("a request to the islands endpoint (its one path under the app's base) is one of the page's holes; a page whose path ends the same is not", () => {
		const c = contention({
			requests: [
				entry(islands_endpoint(), 0, 10, 0),
				entry(`/docs${islands_endpoint()}`, 0, 10, 0)
			],
			windows
		})!;
		expect(c.requests.map((r) => r.kind)).toEqual(['hole', 'other']);
	});

	it('counts every request by kind, though the list stops at 40', () => {
		const requests = Array.from({ length: 45 }, (_, i) => entry(`/self/${i}`, 0, 10, 0));
		const c = contention({
			requests,
			windows,
			self_paths: new Set(requests.map((r) => r.path))
		})!;
		expect(c.requests.length).toBe(40);
		expect(c.counts!.self).toBe(45);
	});
});

describe('render_steps', () => {
	const seg = (t0: number, t1: number, kind: Segment['kind'], label: string): Segment =>
		({ t0, t1, kind, label, category: 'app', phase: 'render' }) as Segment;
	const timeline = (segments: Segment[]) => ({ segments }) as unknown as Timeline;

	it('joins touching CPU segments of one owner, and a gap is a wait named by what was pending', () => {
		const gap = { ...seg(20, 30, 'gap', ''), pending: ['GET /api'] } as unknown as Segment;
		const r = render_steps(timeline([seg(0, 10, 'cpu', 'A'), seg(10, 20, 'cpu', 'A'), gap]))!;
		expect(r.steps.map((s) => [s.kind, s.label, s.ms])).toEqual([
			['cpu', 'A', 20],
			['wait', 'GET /api', 10]
		]);
	});

	it('folds the smallest steps into a neighbour, counted, until at most `max`', () => {
		const r = render_steps(
			timeline([seg(0, 10, 'cpu', 'A'), seg(10, 11, 'cpu', 'B'), seg(11, 30, 'cpu', 'C')]),
			undefined,
			2
		)!;
		expect(r.steps.length).toBe(2);
		expect(r.steps[0]).toMatchObject({ label: 'A', t1: 11, folded: 1 });
	});
});

describe('range_hot', () => {
	const index: StackIndex = {
		frames: [
			{ n: 'f', c: 'app', p: -1 },
			{ n: 'f', c: 'app', p: 0 }
		],
		t: [0, 10],
		d: [10, 10],
		leaf: [1, 1],
		raw: 2,
		window_ms: 20
	};

	it('counts a sample that straddles the start by its overlap', () => {
		expect(range_hot(index, 5, 20).cpu_ms).toBe(15);
	});
});

describe('html_diff', () => {
	it('a one-word change in a long text run is one word', () => {
		const words = 'the quick brown fox jumps over the lazy dog again and again';
		const d = html_diff(`<p>${words}</p>`, `<p>${words.replace('lazy', 'sleepy')}</p>`);
		expect(d.ops.filter((o) => o.kind === 'add').map((o) => o.text)).toEqual(['sleepy']);
	});
});

describe('app_asset_rel', () => {
	it('never walks out of the client folder', () => {
		expect(app_asset_rel('/_app/immutable/../../../etc/passwd')).toBeUndefined();
		expect(app_asset_rel('/_app//x.js')).toBeUndefined();
		expect(app_asset_rel('/base/_app/immutable/chunks/x.js')).toBe('_app/immutable/chunks/x.js');
	});
});

describe('refresh_target', () => {
	const origin = 'https://example.com';

	it('reads the content attribute on either side of http-equiv, quotes off', () => {
		expect(refresh_target(`<meta content="0; URL='/to?q'" http-equiv="refresh">`, origin)).toBe(
			'/to?q'
		);
	});

	it('a body over 2 KB is a page, not a stub', () => {
		const tag = '<meta http-equiv="refresh" content="0;url=/to">';
		expect(refresh_target(tag, origin)).toBe('/to');
		expect(refresh_target(tag + ' '.repeat(2048), origin)).toBeNull();
	});
});
