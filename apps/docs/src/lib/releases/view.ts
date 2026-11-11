/**
 * What a Releases page shows, from the packages' releases and the filters in its address
 * (`?type=major|minor|patch`, `?pre=1` for pre-releases): read on the server, so the filters are
 * plain links and work with JavaScript off.
 */
import { compare_versions, group_by_version, type Kind, type Release } from './changelog.ts';
import type { PackageReleases } from './releases.server.ts';

export type Filters = { type: Kind | null; pre: boolean };

export type PackageLink = { id: string; name: string; count: number };

export type VersionCard = {
	version: string;
	kind: Kind;
	prerelease: boolean;
	/** The earliest tag date of its packages, `YYYY-MM-DD`, or `null` with no tags at build. */
	date: string | null;
	releases: Release[];
};

const KINDS: readonly Kind[] = ['major', 'minor', 'patch']; // static: the three bumps

export function filters_of(url: URL): Filters {
	const t = url.searchParams.get('type');
	return {
		type: (KINDS as readonly string[]).includes(t ?? '') ? (t as Kind) : null,
		pre: url.searchParams.get('pre') === '1'
	};
}

/** The address of this page with `change` applied to its filters (`null` drops one). */
export function href_with(url: URL, change: { type?: Kind | null; pre?: boolean }): string {
	const next = new URL(url);
	if ('type' in change) {
		if (change.type) next.searchParams.set('type', change.type);
		else next.searchParams.delete('type');
	}
	if ('pre' in change) {
		if (change.pre) next.searchParams.set('pre', '1');
		else next.searchParams.delete('pre');
	}
	return next.pathname + next.search;
}

/** The version cards for `releases` under `filters`: newest first (by tag date, then version). */
export function cards(releases: Release[], filters: Filters): VersionCard[] {
	const kept = releases.filter(
		(r) => (filters.pre || !r.prerelease) && (!filters.type || r.kind === filters.type)
	);
	return group_by_version(kept)
		.map((v) => ({
			...v,
			date: v.releases.reduce<string | null>(
				(d, r) => (r.date && (!d || r.date < d) ? r.date : d),
				null
			)
		}))
		.sort((a, b) =>
			a.date && b.date && a.date !== b.date
				? b.date.localeCompare(a.date)
				: compare_versions(b.version, a.version)
		);
}

/** The sidebar: every package, by name, with how many releases it has. */
export function package_links(all: Array<{ id: string; data: PackageReleases }>): PackageLink[] {
	return all
		.map((p) => ({ id: p.id, name: p.data.name, count: p.data.releases.length }))
		.sort((a, b) =>
			a.name === 'ogygia' ? -1 : b.name === 'ogygia' ? 1 : a.name.localeCompare(b.name)
		);
}
