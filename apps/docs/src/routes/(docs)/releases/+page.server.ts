import type { PageServerLoad } from './$types';
import { packages } from '$lib/releases/releases.server';
import { cards, filters_of, package_links } from '$lib/releases/view';
import { SERVER_PAGE_TITLES } from '$lib/og/card';

// Every package's releases, a card per version (the packages release together).
export const load: PageServerLoad = async ({ url }) => {
	const all = await packages.refs();
	const filters = filters_of(url);
	return {
		title: SERVER_PAGE_TITLES.releases,
		current: null,
		packages: package_links(all),
		filters,
		cards: cards(
			all.flatMap((p) => p.data.releases),
			filters
		)
	};
};
