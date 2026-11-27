// Serves adapter-vercel's output the way its two halves answer: a path that is a file of
// `<output>/static` (or `<path>.html`, or `<path>/index.html`) is that file; any other path is asked
// of the output's one function, loaded from `<output>/functions/![-]/catchall.func` by its
// `.vc-config.json` and run with that folder as its working directory, as Vercel runs it. Headers
// from `config.json`'s routes are not applied: vercel.spec.ts reads those from the routes.
//
//   node e2e/serve-vercel.ts <output> <port>
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const [output, port] = [path.resolve(process.argv[2]!), Number(process.argv[3])];
const STATIC = path.join(output, 'static');
const FUNC = path.join(output, 'functions/![-]/catchall.func');
const TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.xml': 'application/xml',
	'.svg': 'image/svg+xml',
	'.avif': 'image/avif',
	'.webp': 'image/webp',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.gif': 'image/gif'
};

const vc = JSON.parse(fs.readFileSync(path.join(FUNC, '.vc-config.json'), 'utf8')) as {
	handler: string;
};
process.chdir(FUNC);
const fn = (
	(await import(pathToFileURL(path.join(FUNC, vc.handler)).href)) as {
		default: { fetch(request: Request): Promise<Response> };
	}
).default;

function file_of(pathname: string): string | null {
	let rel: string;
	try {
		rel = decodeURIComponent(pathname);
		// oxlint-disable-next-line ogygia/no-silent-failures -- a path that does not decode names no file: the function answers it
	} catch {
		return null;
	}
	const base = path.join(STATIC, rel);
	if (!base.startsWith(STATIC)) return null;
	for (const p of [base, `${base}.html`, path.join(base, 'index.html')])
		if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
	return null;
}

async function asked(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	const url = new URL(req.url ?? '/', `http://localhost:${port}`);
	const file = file_of(url.pathname);
	if (file) {
		res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
		fs.createReadStream(file).pipe(res);
		return;
	}
	const headers = new Headers();
	for (const [k, v] of Object.entries(req.headers))
		if (typeof v === 'string') headers.set(k, v);
		else if (v) for (const one of v) headers.append(k, one);
	const has_body = req.method !== 'GET' && req.method !== 'HEAD';
	const answer = await fn.fetch(
		new Request(url, {
			method: req.method,
			headers,
			body: has_body ? (Readable.toWeb(req) as ReadableStream) : null,
			...(has_body ? { duplex: 'half' } : {})
		})
	);
	res.writeHead(answer.status, Object.fromEntries(answer.headers));
	if (answer.body)
		Readable.fromWeb(answer.body as import('node:stream/web').ReadableStream).pipe(res);
	else res.end();
}

http
	.createServer((req, res) => {
		asked(req, res).catch((e: unknown) => {
			console.error(e);
			res.writeHead(502).end('the function threw');
		});
	})
	.listen(port, () => console.log(`vercel output: ${output} at http://localhost:${port}`));
