/**
 * The fixture page: a light shell and four heavy regions (two tables, two highlighted sources),
 * streamed in document order. With threads, every region starts at once and each is written as soon
 * as it and everything above it is done; inline, each renders when the stream reaches it.
 */
import type { Scope } from '@ogygia/machine';
import { render_region } from './jobs.ts' with { run: 'worker' };
import { owned, STALE } from './thread.ts';
import { make_rows, make_source } from './data.ts';

export interface Spec {
	readonly name: 'table' | 'code';
	readonly props: Record<string, unknown>;
}

/** The page's regions. `scale` multiplies the work (LAB_SCALE). */
export function page_regions(scale = 1): Spec[] {
	return [
		{
			name: 'table',
			props: { title: 'Orders this week', rows: make_rows(Math.round(600 * scale), 1) }
		},
		{ name: 'code', props: { title: 'scope.ts', source: make_source(Math.round(250 * scale), 2) } },
		{
			name: 'table',
			props: { title: 'Orders last week', rows: make_rows(Math.round(400 * scale), 3) }
		},
		{
			name: 'code',
			props: { title: 'flights.ts', source: make_source(Math.round(150 * scale), 4) }
		}
	];
}

const HEAD =
	'<!doctype html><html><head><meta charset="utf-8"><title>workers lab</title></head><body><nav>lab</nav><main>';
const TAIL = '</main><footer>end</footer></body></html>';

/** Writes the page through `write`, in order. `false` when the owner closed before the end. */
export async function stream_page(
	owner: Scope,
	regions: readonly Spec[],
	write: (chunk: string) => void
): Promise<boolean> {
	write(HEAD);
	const call = owned(owner, render_region);
	// all start now: on threads they run side by side; inline, each call runs on this thread anyway
	const pending = regions.map((r) => call(r.name, r.props));
	// ok: a failure is thrown by the in-order await below; this only keeps a later region's failure
	// from being reported as unhandled while an earlier one is still being awaited
	for (const p of pending) p.catch(() => undefined);
	for (const p of pending) {
		const html = await p;
		if (html === STALE) return false;
		write(html);
	}
	write(TAIL);
	return true;
}
