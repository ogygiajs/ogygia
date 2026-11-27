import type { EntryGenerator, PageServerLoad } from './$types';
import { packages } from '$lib/releases/releases.server';
import { cards, filters_of, package_links, KINDS } from '$lib/releases/view';

export const prerender = true;

export const entries: EntryGenerator = () => [{}, ...KINDS.map((type) => ({ type }))];

// Every package's releases, a card per version (the packages release together).
export const load: PageServerLoad = async ({ params }) => {
	const all = await packages.refs();
	const filters = filters_of(params.type);
	return {
		title: 'Releases',
		current: null,
		packages: package_links(all),
		filters,
		cards: cards(
			all.flatMap((p) => p.data.releases),
			filters
		)
	};
};
