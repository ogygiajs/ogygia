import { summary, versions } from '$lib/tests/report.server';
import type { EntryGenerator, PageServerLoad } from './$types';

export const prerender = true;

export const entries: EntryGenerator = async () => [
	{},
	...(await versions()).map((version) => ({ version }))
];

export const load: PageServerLoad = async ({ params }) => ({
	...(await summary(params.version)),
	pinned: params.version !== undefined
});
