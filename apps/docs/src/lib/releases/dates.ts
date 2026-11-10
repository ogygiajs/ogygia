/**
 * The Releases pages' dates, read at build (vite.config.ts `releaseDates`): a version's date is when
 * npm published it, the registry document's `time[version]` (one fetch per package). A release tag's
 * date stands in for a version the registry did not answer for (offline); with neither, there is no
 * date. Keys are `<package>@<version>`, values the UTC day (`YYYY-MM-DD`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Dates = Record<string, string>;

const DAY = /^(\d{4}-\d{2}-\d{2})T/;
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

/** Each version's publish day in a registry document (`GET https://registry.npmjs.org/<name>`). */
export function dates_from_registry(name: string, doc: unknown): Dates {
	const time = (doc as { time?: unknown } | null)?.time;
	const out: Dates = {};
	if (!time || typeof time !== 'object') return out;
	for (const [version, at] of Object.entries(time as Record<string, unknown>)) {
		if (!VERSION.test(version) || typeof at !== 'string') continue;
		const day = DAY.exec(at);
		if (day) out[`${name}@${version}`] = day[1];
	}
	return out;
}

/** Each release tag's day, from `git for-each-ref --format='%(refname:strip=2) %(creatordate:short)'`
 *  (the older `v<version>` tags are `ogygia`'s). */
export function dates_from_tags(refs: string): Dates {
	const out: Dates = {};
	for (const line of refs.split('\n')) {
		const [tag, day] = line.trim().split(' ');
		if (!tag || !day) continue;
		const key = /^v\d/.test(tag) ? `ogygia@${tag.slice(1)}` : tag;
		const at = key.lastIndexOf('@');
		if (at > 0 && VERSION.test(key.slice(at + 1))) out[key] = day;
	}
	return out;
}

/** The registry's dates, with the tags' for what it did not say. */
export function merge_dates(registry: Dates, tags: Dates): Dates {
	return { ...tags, ...registry };
}

/** How long a fetched registry date list is reused before it is fetched again (dev restarts). */
const CACHE_MS = 6 * 60 * 60 * 1000;

/**
 * Every date for `names`: each package's registry document fetched once (and kept in `cache_dir` so a
 * dev restart does not fetch again), the release tags for the rest.
 */
export async function release_dates(names: string[], cache_dir: string): Promise<Dates> {
	const file = path.join(cache_dir, 'release-dates.json');
	let cached: { at: number; dates: Dates } | null = null;
	try {
		if (existsSync(file)) cached = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		// ok: an unreadable cache is fetched again
	}
	let registry: Dates = {};
	if (cached && Date.now() - cached.at < CACHE_MS) registry = cached.dates;
	else {
		const answers = await Promise.all(names.map((n) => registry_dates(n)));
		registry = Object.assign({}, ...answers);
		if (Object.keys(registry).length) {
			try {
				mkdirSync(cache_dir, { recursive: true });
				writeFileSync(file, JSON.stringify({ at: Date.now(), dates: registry }));
			} catch {
				// ok: no cache written: the next run fetches again
			}
		} else if (cached) registry = cached.dates; // offline: the last answer is better than none
	}
	return merge_dates(registry, tag_dates());
}

async function registry_dates(name: string): Promise<Dates> {
	try {
		const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, {
			signal: AbortSignal.timeout(10_000)
		});
		return res.ok ? dates_from_registry(name, await res.json()) : {};
	} catch {
		return {}; // ok: offline, or the registry did not answer: the tags stand in
	}
}

function tag_dates(): Dates {
	try {
		return dates_from_tags(
			execFileSync(
				'git',
				['for-each-ref', '--format=%(refname:strip=2) %(creatordate:short)', 'refs/tags'],
				{ encoding: 'utf8' }
			)
		);
	} catch {
		return {}; // ok: no git here, or no tags (a shallow clone)
	}
}
