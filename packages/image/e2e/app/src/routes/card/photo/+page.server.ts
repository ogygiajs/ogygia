import { PhotoCard } from '$lib/cards/photo.server';

export const load = () => ({ share: PhotoCard({ title: 'A card with images' }) });
