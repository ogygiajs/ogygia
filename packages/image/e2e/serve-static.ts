// Serves a folder as plain files, the way a static host does: a path is a file (or `<path>.html`, or
// `<path>/index.html`), the type comes from the extension, and nothing else answers. No Kit, no
// ogygia, no image endpoint: what the prerender did not write is a 404.
//
//   node e2e/serve-static.ts <dir> <port> [base]   (base: the app's paths.base, `/base`)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [dir, port, base] = [
	path.resolve(process.argv[2]!),
	Number(process.argv[3]),
	process.argv[4] ?? ''
];
const TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.avif': 'image/avif',
	'.webp': 'image/webp',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif'
};

function file_of(pathname: string): string | null {
	let rel: string;
	try {
		rel = decodeURIComponent(pathname);
		// oxlint-disable-next-line ogygia/no-silent-failures -- a path that does not decode names no file: 404
	} catch {
		return null;
	}
	const base = path.join(dir, rel);
	if (!base.startsWith(dir)) return null;
	for (const p of [base, `${base}.html`, path.join(base, 'index.html')])
		if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
	return null;
}

http
	.createServer((req, res) => {
		const pathname = new URL(req.url ?? '/', 'http://x').pathname;
		const file =
			pathname === base || pathname.startsWith(`${base}/`)
				? file_of(pathname.slice(base.length) || '/')
				: null;
		if (!file) {
			res.writeHead(404).end('not found');
			return;
		}
		res.writeHead(200, {
			'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream'
		});
		fs.createReadStream(file).pipe(res);
	})
	.listen(port, () => console.log(`static: ${dir} at http://localhost:${port}`));
