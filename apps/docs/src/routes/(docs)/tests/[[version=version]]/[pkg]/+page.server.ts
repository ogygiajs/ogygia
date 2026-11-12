import { error } from '@sveltejs/kit';
import { rows, slug_of } from '$lib/tests/data';
import { package_report, summary, versions } from '$lib/tests/report.server';
import type { EntryGenerator, PageServerLoad } from './$types';

export const prerender = true;

export const entries: EntryGenerator = async () => {
	const all = await versions();
	const out: { version?: string; pkg: string }[] = [];
	for (const [i, version] of all.entries()) {
		for (const name of Object.keys((await summary(version)).summary.packages)) {
			out.push({ version, pkg: slug_of(name) });
			if (i === 0) out.push({ pkg: slug_of(name) });
		}
	}
	return out;
};

export const load: PageServerLoad = async ({ params }) => {
	const { summary: s, versions: all } = await summary(params.version);
	const name = Object.keys(s.packages).find((n) => slug_of(n) === params.pkg);
	const report = name && (await package_report(s.version, name));
	if (!name || !report) error(404, `No test report for ${params.pkg} in ${s.version}`);
	// The picker offers the versions this package has a report in.
	const has = await Promise.all(
		all.map(async (v) => (await package_report(v, name)) !== undefined)
	);
	return {
		version: s.version,
		date: s.date,
		commit: s.commit,
		e2e: s.e2e !== false,
		versions: all.filter((_, i) => has[i]),
		pinned: params.version !== undefined,
		name,
		slug: params.pkg,
		pkg: s.packages[name],
		ratioDefinition: s.totals.ratioDefinition,
		rows: rows(report)
	};
};
