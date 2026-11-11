import { error } from '@sveltejs/kit';
import { package_report, slug_of, summary, versions } from '$lib/tests/data';
import type { EntryGenerator, PageServerLoad } from './$types';

export const prerender = true;

export const entries: EntryGenerator = async () => {
	const all = await versions();
	const out: { version?: string; pkg: string }[] = [];
	for (const [i, version] of all.entries()) {
		const names = Object.keys((await summary(version)).summary.packages).map(slug_of);
		for (const pkg of names) {
			out.push({ version, pkg });
			if (i === 0) out.push({ pkg });
		}
	}
	return out;
};

export const load: PageServerLoad = async ({ params }) => {
	const { summary: s, versions: all } = await summary(params.version);
	const name = Object.keys(s.packages).find((n) => slug_of(n) === params.pkg);
	const report = name && (await package_report(s.version, params.pkg));
	if (!name || !report) error(404, `No test report for ${params.pkg} in ${s.version}`);
	// The picker offers the versions this package has a report in.
	const has = await Promise.all(
		all.map(async (v) => (await package_report(v, params.pkg)) !== undefined)
	);
	return {
		version: s.version,
		date: s.date,
		commit: s.commit,
		versions: all.filter((_, i) => has[i]),
		pinned: params.version !== undefined,
		name,
		slug: params.pkg,
		pkg: s.packages[name],
		report
	};
};
