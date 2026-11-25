import { error } from '@sveltejs/kit';
import type { EntryGenerator, PageServerLoad } from './$types';
import { packages } from '$lib/releases/releases.server';
import { cards, filters_of, package_links, KINDS } from '$lib/releases/view';

export const prerender = true;

export const entries: EntryGenerator = async () =>
	(await packages.refs()).flatMap((p) => [
		{ package: p.id },
		...KINDS.map((type) => ({ package: p.id, type }))
	]);

// One package's releases (`/releases/core`, `/releases/ogygia/patch`).
export const load: PageServerLoad = async ({ params }) => {
	const all = await packages.refs();
	const one = all.find((p) => p.id === params.package);
	if (!one) error(404, `No package is called ${params.package}`);
	const filters = filters_of(params.type);
	return {
		title: one.data.name,
		current: one.id,
		packages: package_links(all),
		filters,
		cards: cards(one.data.releases, filters)
	};
};
