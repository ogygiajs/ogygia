import { error } from '@sveltejs/kit';
import { blog } from '$lib/blog.server.ts';

export const load = async ({ params }) => {
	const entry = await blog.get(params.slug);
	if (!entry) error(404, 'no such post');
	return { title: entry.data.title, cover: entry.data.cover, body: await entry.body };
};
