/**
 * What a Releases page shows, from the packages' releases and the filter in its path
 * (`/releases/patch`, `/releases/core/minor`): each filter is its own prerendered page, so the
 * filters are plain links and work with JavaScript off.
 */
import { compare_versions, group_by_version, type Kind, type Release } from './changelog.ts';
import type { PackageReleases } from './releases.server.ts';

export type Filters = { type: Kind | null };

export type PackageLink = { id: string; name: string; count: number };

export type VersionCard = {
	version: string;
	kind: Kind;
	prerelease: boolean;
	/** The earliest tag date of its packages, `YYYY-MM-DD`, or `null` with no tags at build. */
	date: string | null;
	releases: Release[];
};

export const KINDS: readonly Kind[] = ['major', 'minor', 'patch'];

export function is_kind(value: string): value is Kind {
	return (KINDS as readonly string[]).includes(value);
}

export function filters_of(type: string | undefined): Filters {
	return { type: type !== undefined && is_kind(type) ? type : null };
}

/** The address of the Releases page for `current` (a package id, or `null` for all) under `type`. */
export function href_for(current: string | null, type: Kind | null): string {
	return `/releases${current ? `/${current}` : ''}${type ? `/${type}` : ''}`;
}

/** The version cards for `releases` under `filters`: newest first (by tag date, then version). */
export function cards(releases: Release[], filters: Filters): VersionCard[] {
	const kept = releases.filter((r) => !filters.type || r.kind === filters.type);
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
