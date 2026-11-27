// What the two vercel modes share: the `images` the fixture's `vercel({ sizes })` hands the
// adapter, the links /late/whole names (an 80 px wide resize of a 160 px source: widths 80 and
// 160, snapped up to the sizes 128 and 256, each in AVIF and WebP at their default qualities), and
// how a page's links are read back.
import { expect } from '@ogygia/tooling/e2e';

export const VERCEL_IMAGES = {
	sizes: [64, 128, 256, 640, 1280, 2048],
	qualities: [60, 80],
	formats: ['image/avif', 'image/webp'],
	domains: [],
	localPatterns: [{ pathname: '^/_app/immutable/assets/.+$', search: '' }],
	remotePatterns: [{ protocol: 'http', hostname: '^127\\.0\\.0\\.1$', port: '4176' }]
};

const ORIGINAL = '%2F_app%2Fimmutable%2Fassets%2Fone.<hash>.png';

export const WHOLE_LINKS: readonly string[] = [
	`/_vercel/image?url=${ORIGINAL}&w=128&q=60`,
	`/_vercel/image?url=${ORIGINAL}&w=128&q=80`,
	`/_vercel/image?url=${ORIGINAL}&w=256&q=60`,
	`/_vercel/image?url=${ORIGINAL}&w=256&q=80`
];

const LINK_RE = /\/_vercel\/image\?url=[^\s"]+?&amp;w=\d+&amp;q=\d+/g;
const HASHED_RE = /one\.[\w-]+\.png/;

/** The `/_vercel/image` links to the late image `one.png` that `pathname` names, `&amp;` read as
 *  `&`, each once, sorted, the original's hash written `<hash>` unless `hashed`. */
export async function linked(
	request: import('@playwright/test').APIRequestContext,
	pathname: string,
	hashed = false
): Promise<string[]> {
	const res = await request.get(pathname);
	expect(res.status(), pathname).toBe(200);
	const links = new Set(
		((await res.text()).match(LINK_RE) ?? [])
			.map((l) => l.replaceAll('&amp;', '&'))
			.filter((l) => HASHED_RE.test(l))
	);
	return [...links]
		.map((l) => (hashed ? l : l.replace(HASHED_RE, 'one.<hash>.png')))
		.sort((a, b) => a.localeCompare(b));
}
