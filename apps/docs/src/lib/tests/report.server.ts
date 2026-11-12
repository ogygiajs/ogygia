import { error } from '@sveltejs/kit';
import { compare_versions, file_of, type PackageReport, type Summary } from './data';

// Read at build time (the /tests pages are prerendered), so a report ships with the deploy that
// shows it, and the report files never reach a browser bundle.
const files = import.meta.glob<unknown>('/static/tests/**/*.json', { import: 'default' });

async function read<T>(path: string): Promise<T | undefined> {
	const load = files[`/static/tests/${path}`];
	return load ? ((await load()) as T) : undefined;
}

/** Every version with a report, newest first. */
export async function versions(): Promise<string[]> {
	const index = await read<{ versions: string[] }>('index.json');
	return [...(index?.versions ?? [])].sort(compare_versions);
}

/** The newest version's report, or the named one. A version with no report is a 404. */
export async function summary(version?: string): Promise<{ summary: Summary; versions: string[] }> {
	const all = await versions();
	const v = version ?? all[0];
	const s = v && all.includes(v) ? await read<Summary>(`${v}/summary.json`) : undefined;
	if (!s) error(404, version ? `No test report for ${version}` : 'No test report yet');
	return { summary: s, versions: all };
}

export function package_report(version: string, name: string) {
	return read<PackageReport>(`${version}/${file_of(name)}`);
}
