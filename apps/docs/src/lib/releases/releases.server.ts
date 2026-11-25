/**
 * The Releases pages' data: a content collection (dogfoods `@ogygia/content`) with one entry per
 * published package, read at build from its CHANGELOG.md (the site deploys from `latest`, which is
 * what npm has). An entry's id is the package's folder (`core`, `machine`, `ogygia`), its data the
 * package name and its releases. Dates come from the release tags (`virtual:release-dates`).
 */
import { content, defineSource, glob } from '@ogygia/content';
import dates from 'virtual:release-dates';
import * as v from 'valibot';
import { read_changelog, type Release } from './changelog.ts';

// The tsdown Svelte plugin is build tooling on its own version line, not part of ogygia's releases.
const changelogs = import.meta.glob(
	[
		'../../../../../packages/*/CHANGELOG.md',
		'!../../../../../packages/tsdown-plugin-svelte/CHANGELOG.md'
	],
	{
		query: '?raw',
		import: 'default',
		eager: true
	}
) as Record<string, string>;
const names = import.meta.glob('../../../../../packages/*/package.json', {
	import: 'name',
	eager: true
}) as Record<string, string>;

/** `../../../../../packages/core/CHANGELOG.md` → `core`. */
const folder_of = (key: string) => key.split('/').at(-2)!;

/** Each package's name, by its folder. */
const name_by_folder = new Map(Object.entries(names).map(([k, n]) => [folder_of(k), n])); // static: read once at build

const schema = v.object({
	name: v.string(),
	releases: v.array(v.custom<Release>((r) => typeof r === 'object' && r !== null))
});

export type PackageReleases = v.InferOutput<typeof schema>;

export const packages = content({
	schema,
	loader: defineSource(glob<string>(changelogs, { id: folder_of }), (markdown, id) => {
		const name = name_by_folder.get(id) ?? id;
		const releases = read_changelog(name, markdown).map((r) => ({
			...r,
			date: dates[`${name}@${r.version}`] ?? r.date
		}));
		return { data: { name, releases } satisfies PackageReleases };
	})
});
