import { ShareCard } from '$lib/og/share';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ share: ShareCard({ title: 'csr = true' }) });
