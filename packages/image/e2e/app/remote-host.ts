import http from 'node:http';
import sharp from 'sharp';

// The fixture's remote image host, listed in vite.config.ts (`image({ remote: { hosts } })`): a
// plain HTTP server on 127.0.0.1:4176, started by the config of whichever process loads it first
// (the build, the dev server), never keeping that process alive. Its pictures are drawn by sharp,
// with an etag, so a build that keeps the cache revalidates with a 304. `/moved/…` redirects to
// `/photos/…`.
export const REMOTE_PORT = 4176;
export const REMOTE_ORIGIN = `http://127.0.0.1:${REMOTE_PORT}`;

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

export async function serve_remote_host(): Promise<void> {
	const files = new Map<string, Buffer>([
		['/photos/field.jpg', await picture(1200, 800, '#3a6ea5')],
		['/photos/cover.jpg', await picture(1600, 900, '#5b8c5a')]
	]);
	const server = http.createServer((req, res) => {
		const at = (req.url ?? '/').split('?')[0]!;
		if (at.startsWith('/moved/')) {
			res.writeHead(302, { location: at.replace('/moved/', '/photos/') });
			res.end();
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
		res.writeHead(200, { 'content-type': 'image/jpeg', etag });
		res.end(bytes);
	});
	await new Promise<void>((done) => {
		server.once('error', () => done());
		server.listen(REMOTE_PORT, '127.0.0.1', () => done());
	});
	server.unref();
}
