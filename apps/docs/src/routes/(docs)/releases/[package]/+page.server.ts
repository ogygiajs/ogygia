import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { packages } from '$lib/releases/releases.server';
import { cards, filters_of, package_links } from '$lib/releases/view';

// One package's releases (`/releases/core`, `/releases/ogygia`).
export const load: PageServerLoad = async ({ params, url }) => {
	const all = await packages.refs();
	const one = all.find((p) => p.id === params.package);
	if (!one) error(404, `No package is called ${params.package}`);
	const filters = filters_of(url);
	return {
		title: one.data.name,
		current: one.id,
		packages: package_links(all),
		filters,
		cards: cards(one.data.releases, filters)
	};
};
