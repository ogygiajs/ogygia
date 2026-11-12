import type { PageServerLoad } from './$types';
import { packages } from '$lib/releases/releases.server';
import { cards, filters_of, package_links } from '$lib/releases/view';

// Every package's releases, a card per version (the packages release together).
export const load: PageServerLoad = async ({ url }) => {
	const all = await packages.refs();
	const filters = filters_of(url);
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
