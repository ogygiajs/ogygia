/**
 * The framework benchmark's numbers for the performance page. The benchmark lives in its own repo
 * (ogygiajs/benchmarks) and publishes each run on `main` to a `results` branch; this reads the newest
 * one once, at build time (a prerender remote: the page is static, so nothing fetches at runtime).
 * A docs build must never fail on the network, so any miss (offline, a 404, a timeout, a file the
 * chart could not draw) falls back to the committed copy next to this file.
 */
import { prerender } from '$app/server';
import committed from './results.json';

const LIVE = 'https://raw.githubusercontent.com/ogygiajs/benchmarks/results/main/latest.json';

export type BenchRow = {
	post: string;
	words: number;
	jsRaw: number;
	jsBr: number;
	htmlRaw: number;
	htmlBr: number;
	score: number;
	lcp: number;
	cls: number;
	tbt: number;
	evalMs: number;
	dom: number;
};
export type BenchFramework = {
	id: string;
	approach: string;
	rows: BenchRow[];
	avg: Pick<BenchRow, 'score' | 'lcp' | 'cls' | 'tbt' | 'evalMs' | 'dom'>;
};
/** What the run measured; the committed copy predates it, so it may be missing. */
export type BenchMeta = {
	ogygia?: string;
	sha?: string;
	mode?: 'pr' | 'main' | 'manual';
	passes?: number;
	runAt?: string;
};
export type BenchResults = {
	posts: { id: string; words: number }[];
	frameworks: BenchFramework[];
	meta?: BenchMeta;
	/** true when the live file was unreachable and the committed copy was used */
	fallback: boolean;
};

const is_record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const is_number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

// Only what the chart reads: a file that passes this draws, one that does not would throw mid-build.
function is_results(v: unknown): v is Omit<BenchResults, 'fallback'> {
	if (!is_record(v) || !Array.isArray(v.posts) || !Array.isArray(v.frameworks)) return false;
	if (v.posts.length < 2 || v.frameworks.length === 0) return false;
	if (!v.posts.every((p) => is_record(p) && typeof p.id === 'string' && is_number(p.words)))
		return false;
	return v.frameworks.every(
		(f) =>
			is_record(f) &&
			typeof f.id === 'string' &&
			is_record(f.avg) &&
			['score', 'lcp', 'cls'].every((k) => is_number((f.avg as Record<string, unknown>)[k])) &&
			Array.isArray(f.rows) &&
			f.rows.length > 0 &&
			f.rows.every(
				(r) => is_record(r) && ['words', 'jsRaw', 'jsBr', 'evalMs'].every((k) => is_number(r[k]))
			)
	);
}

export const bench_results = prerender(async (): Promise<BenchResults> => {
	try {
		const res = await fetch(LIVE, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const live: unknown = await res.json();
		if (!is_results(live)) throw new Error('not a results file');
		return {
			posts: live.posts,
			frameworks: live.frameworks,
			meta: is_record(live.meta) ? live.meta : undefined,
			fallback: false
		};
	} catch (err) {
		console.warn(
			`[docs] live benchmark results unavailable (${String(err)}): using the committed copy`
		);
		return {
			posts: committed.posts,
			frameworks: committed.frameworks as BenchFramework[],
			fallback: true
		};
	}
});
