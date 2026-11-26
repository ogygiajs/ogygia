import { ShareCard } from '$lib/cards/share.server';
import type { PageServerLoad } from './$types';

export const prerender = false;

const PHOTO = import.meta.og.image('../../../lib/late/one.png');

export const load: PageServerLoad = ({ url }) => {
	const section = url.searchParams.get('section');
	return {
		share: ShareCard({
			title: url.searchParams.get('title') ?? 'Rendered on request',
			...(section ? { section } : {}),
			...(url.searchParams.has('photo') ? { photo: PHOTO.src } : {})
		})
	};
};
