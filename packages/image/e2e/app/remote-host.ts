import http from 'node:http';
import sharp from 'sharp';

// The fixture's remote image host, listed in vite.config.ts (`image({ remote: { hosts } })`): a
// plain HTTP server on 127.0.0.1:4176, started by the config of whichever process loads it first
// (the build, the dev server), never keeping that process alive. Its pictures are drawn by sharp,
// with an etag, so a build that keeps the cache revalidates with a 304. `/moved/…` redirects to
// `/photos/…`. `/huge.jpg` is 30 MB (past the default `remote.maxBytes`), and `/slow.jpg` sends
// its headers and stops for 8 s (past the fixture's `remote.timeout`).
export const REMOTE_PORT = 4176;
export const REMOTE_ORIGIN = `http://127.0.0.1:${REMOTE_PORT}`;
/** The fixture's `remote.timeout`, in ms. */
export const REMOTE_TIMEOUT = 3000;
const HUGE_BYTES = 30_000_000;
const SLOW_MS = 8000;

async function picture(width: number, height: number, background: string): Promise<Buffer> {
	const stripe = await sharp({
		create: { width: Math.round(width / 3), height, channels: 3, background: '#f2c14e' }
	})
		.png()
		.toBuffer();
	return sharp({ create: { width, height, channels: 3, background } })
		.composite([{ input: stripe, left: 0, top: 0 }])
		.jpeg({ quality: 80 })
		.toBuffer();
}

/** The path of the small WebP the photo card draws (src/lib/cards/PhotoCard.svelte). */
export const MARK_PATH = '/photos/mark.webp';
/** The path that answers how many times this host was asked for each path, as JSON. */
export const ASKED_PATH = '/__asked';
/** The one color of {@link MARK_PATH}. */
export const MARK_RGB: readonly [number, number, number] = [228, 87, 46];

function mark(): Promise<Buffer> {
	const [r, g, b] = MARK_RGB;
	return sharp({ create: { width: 300, height: 300, channels: 3, background: { r, g, b } } })
		.webp({ lossless: true })
		.toBuffer();
}

export async function serve_remote_host(): Promise<http.Server | null> {
	const files = new Map<string, Buffer>([
		['/photos/field.jpg', await picture(1200, 800, '#3a6ea5')],
		['/photos/cover.jpg', await picture(1600, 900, '#5b8c5a')],
		[MARK_PATH, await mark()]
	]);
	const asked = new Map<string, number>();
	const server = http.createServer((req, res) => {
		const at = (req.url ?? '/').split('?')[0]!;
		if (at === ASKED_PATH) {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(Object.fromEntries(asked)));
			return;
		}
		asked.set(at, (asked.get(at) ?? 0) + 1);
		if (at.startsWith('/moved/')) {
			res.writeHead(302, { location: at.replace('/moved/', '/photos/') });
			res.end();
			return;
		}
		if (at === '/huge.jpg') {
			res.writeHead(200, { 'content-type': 'image/jpeg' });
			res.write(Buffer.from([0xff, 0xd8, 0xff]));
			res.end(Buffer.alloc(HUGE_BYTES));
			return;
		}
		if (at === '/slow.jpg') {
			res.writeHead(200, { 'content-type': 'image/jpeg' });
			res.write(Buffer.from([0xff, 0xd8, 0xff]));
			setTimeout(() => res.end(), SLOW_MS).unref();
			return;
		}
		const bytes = files.get(at);
		if (bytes === undefined) {
			res.writeHead(404);
			res.end();
			return;
		}
		const etag = `"${bytes.length}"`;
		if (req.headers['if-none-match'] === etag) {
			res.writeHead(304, { etag });
			res.end();
			return;
		}
		res.writeHead(200, {
			'content-type': at.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
			etag
		});
		res.end(bytes);
	});
	const bound = await new Promise<boolean>((done) => {
		server.once('error', () => done(false));
		server.listen(REMOTE_PORT, '127.0.0.1', () => done(true));
	});
	server.unref();
	return bound ? server : null;
}
