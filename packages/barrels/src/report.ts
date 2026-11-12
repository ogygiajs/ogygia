/** The end-of-build report: what the pass did in one build leg. */
import { line } from './messages.ts';

/** What the pass did in one build leg (reset after each print: Kit runs several). */
export interface BarrelsReport {
	files: number;
	importers: number;
	imports: number;
	names: number;
	/** wall-clock span from the first transform to the last (transforms overlap, so a sum of
	 *  per-file durations would count the same waiting many times over) */
	first_ms: number;
	last_ms: number;
	barrels: Map<string, { names: number; importers: Set<string> }>;
	/** components the parser could not read: their imports were left on their barrels */
	skipped: Set<string>;
}

export const fresh_report = (): BarrelsReport => ({
	files: 0,
	importers: 0,
	imports: 0,
	names: 0,
	first_ms: 0,
	last_ms: 0,
	barrels: new Map(),
	skipped: new Set()
});

/** `id` relative to `root` when it is under it. */
export function short(id: string, root: string): string {
	return id.startsWith(`${root}/`) ? id.slice(root.length + 1) : id;
}

const n = (v: number) => v.toLocaleString('en-US');

/** Totals, time spent in the pass, and the barrels by names moved: the `limit` biggest and a count
 *  of the rest (`Infinity` for every one). */
export function format_report(r: BarrelsReport, root: string, limit: number): string {
	const span_s = ((r.last_ms - r.first_ms) / 1000).toFixed(2);
	// components the parser could not read keep their barrels: said in every report, named
	const skipped = r.skipped.size
		? [
				`  ${n(r.skipped.size)} component${r.skipped.size === 1 ? '' : 's'} skipped (could not be parsed; their imports stay on their barrels): ${[
					...r.skipped
				]
					.slice(0, limit)
					.map((id) => short(id, root))
					.join(', ')}${r.skipped.size > limit ? ` and ${n(r.skipped.size - limit)} more` : ''}`
			]
		: [];
	if (r.importers === 0)
		return [line('barrels_report_none', { files: n(r.files), seconds: span_s }), ...skipped].join(
			'\n'
		);
	const head = line('barrels_report', {
		importers: n(r.importers),
		files: n(r.files),
		imports: n(r.imports),
		names: n(r.names),
		barrels: n(r.barrels.size),
		seconds: span_s
	});
	const sorted = [...r.barrels.entries()].sort((a, b) => b[1].names - a[1].names);
	const top = sorted.slice(0, limit);
	const width = Math.max(...top.map(([, b]) => n(b.names).length));
	const rows = top.map(
		([id, b]) =>
			`  ${n(b.names).padStart(width)} names  ${short(id, root)}  ← ${n(b.importers.size)} importer${b.importers.size === 1 ? '' : 's'}`
	);
	const rest = sorted.length - top.length;
	if (rest > 0)
		rows.push(
			`  … and ${n(rest)} more barrel${rest === 1 ? '' : 's'} (\`barrels({ report: 'all' })\` lists every one)`
		);
	return [head, ...rows, ...skipped].join('\n');
}
