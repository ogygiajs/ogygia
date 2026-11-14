import type { Verdict, PageVerdict, MetricRow } from './compare.ts';

const UNIT_SUFFIX: Readonly<Record<MetricRow['unit'], string>> = { ms: ' ms', KB: ' KB', n: '' };
const fmt = (n: number | null, unit: MetricRow['unit']) => {
	if (n === null) return '—';
	return unit === 'n' ? String(Math.round(n)) : `${n.toFixed(1)}${UNIT_SUFFIX[unit]}`;
};
const sign = (d: number | null, unit: MetricRow['unit']) =>
	d === null
		? 'new'
		: `${d > 0 ? '+' : ''}${unit === 'n' ? Math.round(d) : d.toFixed(1)}${UNIT_SUFFIX[unit]}`;
const pct = (p: number | null) => (p === null ? '' : ` (${p > 0 ? '+' : ''}${p.toFixed(0)}%)`);

/**
 * A verdict as the PR comment. It leads with the outcome, then one table per page (metric, base,
 * PR, Δ, budget), then the three biggest movers with their file, then the findings that appeared.
 * It links the two reports when the runner has them.
 */
export function markdown(
	v: Verdict,
	opts: { title?: string; links?: Record<string, { base?: string; cur?: string }> } = {}
): string {
	const lines: string[] = [];
	lines.push(
		`### ${opts.title ?? 'Performance'}: ${v.ok ? '✅ within budget' : `❌ ${v.failures.length} budget failure${v.failures.length === 1 ? '' : 's'}`}`
	);
	lines.push('');
	if (!v.ok) {
		for (const f of v.failures) lines.push(`- ❌ ${f}`);
		lines.push('');
	}
	for (const p of v.pages) lines.push(...page_md(p, opts.links?.[p.page]));
	if (v.missing.length)
		lines.push(`_Not measured this run (in the baseline): ${v.missing.join(', ')}_`, '');
	lines.push(
		'<sub>ogygia profiler · medians over the runs · a positive Δ is slower or bigger</sub>'
	);
	return lines.join('\n');
}

function page_md(p: PageVerdict, links?: { base?: string; cur?: string }): string[] {
	const out: string[] = [];
	const head = p.fresh ? `${p.page} (new page, no baseline)` : p.page;
	const link = links?.cur
		? ` · [report](${links.cur})${links.base ? ` · [baseline](${links.base})` : ''}`
		: '';
	out.push(`#### ${p.failures.length ? '❌' : '✅'} \`${head}\`${link}`);
	out.push('');
	out.push('| metric | base | PR | Δ | budget |');
	out.push('|---|---:|---:|---:|---|');
	for (const r of p.rows) {
		const flag = r.over ? ' ❌' : '';
		out.push(
			`| ${r.metric} | ${fmt(r.base, r.unit)} | ${fmt(r.cur, r.unit)} | ${sign(r.delta, r.unit)}${pct(r.pct)}${flag} | ${r.limit} |`
		);
	}
	out.push('');
	const movers = p.movers.slice(0, 3);
	if (movers.length) {
		out.push('**Biggest movers**');
		for (const m of movers)
			out.push(
				`- ${m.over ? '❌ ' : ''}${m.kind} \`${m.name}\`${m.file ? ` (${m.file})` : ''}: ${m.base.toFixed(1)} → ${m.cur.toFixed(1)} ms (${m.delta > 0 ? '+' : ''}${m.delta.toFixed(1)})`
			);
		out.push('');
	}
	if (p.warnings.added.length || p.warnings.gone.length) {
		if (p.warnings.added.length)
			out.push(`**Findings that appeared:** ${p.warnings.added.map((w) => `\`${w}\``).join(', ')}`);
		if (p.warnings.gone.length)
			out.push(`**Findings that went away:** ${p.warnings.gone.map((w) => `\`${w}\``).join(', ')}`);
		out.push('');
	}
	return out;
}

/** The terminal's view: one line per page, the failures spelled out. */
export function summary(v: Verdict): string {
	const lines: string[] = [];
	for (const p of v.pages) {
		const render = p.rows.find((r) => r.metric === 'render (median)')!;
		lines.push(
			`${p.failures.length ? '✗' : '✓'} ${p.page}  render ${fmt(render.cur, 'ms')}${render.delta !== null ? ` (${sign(render.delta, 'ms')}${pct(render.pct)})` : ' (new)'}${p.failures.length ? `\n    ${p.failures.join('\n    ')}` : ''}`
		);
	}
	if (v.missing.length) lines.push(`  not measured: ${v.missing.join(', ')}`);
	lines.push(
		v.ok
			? 'within budget'
			: `${v.failures.length} budget failure${v.failures.length === 1 ? '' : 's'}`
	);
	return lines.join('\n');
}
