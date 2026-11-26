// Remote images at build (src/vite/remote.ts, src/remote-hosts.ts): which URLs a `hosts` list takes,
// and the fetch into the build cache against a local HTTP server (no internet): a first fetch, a
// 304 that keeps the copy, redirects checked hop by hop, the size cap, the content type, the
// timeout, and a host that is gone with a copy kept and without one.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { entry_for, is_host_entry, RemoteHosts } from '../src/remote-hosts.ts';
import { fetched_file, RemoteImages, remote_name, type Ask } from '../src/vite/remote.ts';
import { check_plugin_options } from '../src/vite/options.ts';
import { is_remote } from '../src/on-disk.ts';

describe('hosts', () => {
	const allows = (entries: string[], url: string): boolean =>
		new RemoteHosts(entries).allows(new URL(url));

	test('a name lists that name, over https, on the default port', () => {
		expect(allows(['images.example.com'], 'https://images.example.com/a.jpg')).toBe(true);
		expect(allows(['images.example.com'], 'https://IMAGES.example.com/a.jpg')).toBe(true);
		expect(allows(['images.example.com'], 'http://images.example.com/a.jpg')).toBe(false);
		expect(allows(['images.example.com'], 'https://images.example.com:8443/a.jpg')).toBe(false);
		expect(allows(['images.example.com'], 'https://a.images.example.com/a.jpg')).toBe(false);
	});

	test("a name inside another host's name is not that host", () => {
		expect(allows(['images.example.com'], 'https://images.example.com.evil.com/a.jpg')).toBe(false);
		expect(allows(['images.example.com'], 'https://evil.com.images.example.com/a.jpg')).toBe(false);
		expect(allows(['*.example.com'], 'https://evil.com.images.example.com/a.jpg')).toBe(true);
		expect(allows(['*.example.com'], 'https://example.com.evil.com/a.jpg')).toBe(false);
		expect(allows(['images.example.com'], 'https://evilimages.example.com/a.jpg')).toBe(false);
	});

	test('*. lists every name below, one label or more, never the name itself', () => {
		expect(allows(['*.cdn.example.com'], 'https://a.cdn.example.com/x.png')).toBe(true);
		expect(allows(['*.cdn.example.com'], 'https://a.b.cdn.example.com/x.png')).toBe(true);
		expect(allows(['*.cdn.example.com'], 'https://cdn.example.com/x.png')).toBe(false);
		expect(allows(['*.cdn.example.com'], 'https://xcdn.example.com/x.png')).toBe(false);
	});

	test('plain http only from an entry that says http://, with its port', () => {
		expect(allows(['http://127.0.0.1:4100'], 'http://127.0.0.1:4100/a.png')).toBe(true);
		expect(allows(['http://127.0.0.1:4100'], 'https://127.0.0.1:4100/a.png')).toBe(false);
		expect(allows(['http://127.0.0.1:4100'], 'http://127.0.0.1:4101/a.png')).toBe(false);
		expect(allows(['https://images.example.com'], 'https://images.example.com/a.png')).toBe(true);
	});

	test('a URL with a user or password in it is never listed', () => {
		expect(allows(['images.example.com'], 'https://u:p@images.example.com/a.jpg')).toBe(false);
		expect(allows(['evil.com'], 'https://images.example.com@evil.com/a.jpg')).toBe(false);
		expect(allows(['images.example.com'], 'https://images.example.com@evil.com/a.jpg')).toBe(false);
	});

	test('an entry with a path, a wildcard over an address or a top-level name, or a range is refused', () => {
		for (const bad of [
			'',
			'*',
			'*.com',
			'*.127.0.0.1',
			'images.example.com/a',
			'images.example.com?x',
			'u@images.example.com',
			'10.0.0.0/8',
			'ftp://images.example.com',
			'a.*.example.com',
			'*.*.example.com'
		])
			expect(is_host_entry(bad), bad).toBe(false);
		for (const good of [
			'images.example.com',
			'*.cdn.example.com',
			'http://127.0.0.1:4100',
			'localhost:8080',
			'[::1]:8080'
		])
			expect(is_host_entry(good), good).toBe(true);
	});

	test('a *. entry over a public suffix anyone can host under is refused; one over a name below it, or that name itself, is not', () => {
		for (const bad of [
			'*.co.uk',
			'*.github.io',
			'*.vercel.app',
			'*.workers.dev',
			'*.s3.amazonaws.com',
			'*.CO.UK'
		])
			expect(is_host_entry(bad), bad).toBe(false);
		for (const good of ['*.mysite.github.io', 'images.github.io', '*.cdn.example.co.uk'])
			expect(is_host_entry(good), good).toBe(true);
	});

	test("a public suffix written with DNS's trailing dot, or a regional storage name, is a public suffix too", () => {
		for (const bad of [
			'*.github.io.',
			'*.co.uk.',
			'*.s3.us-east-1.amazonaws.com',
			'*.s3-eu-west-1.amazonaws.com',
			'*.s3.dualstack.ap-south-1.amazonaws.com',
			'*.r2.cloudflarestorage.com',
			'*.supabase.co'
		])
			expect(is_host_entry(bad), bad).toBe(false);
		for (const good of ['*.my-bucket.s3.us-east-1.amazonaws.com', 'images.example.com.'])
			expect(is_host_entry(good), good).toBe(true);
	});

	test('a *. entry over a name above a shared suffix (so over every tenant of it) is refused; one over a single tenant is not', () => {
		for (const bad of [
			'*.googleapis.com',
			'*.windows.net',
			'*.core.windows.net',
			'*.cloudflarestorage.com',
			'*.us-east-1.amazonaws.com',
			'*.eu-west-1.amazonaws.com',
			'*.compute-1.amazonaws.com',
			'*.us-west-2.compute.amazonaws.com',
			'*.web.core.windows.net'
		])
			expect(is_host_entry(bad), bad).toBe(false);
		for (const good of [
			'*.my-bucket.s3.us-east-1.amazonaws.com',
			'*.account.r2.cloudflarestorage.com',
			'*.images.example.com',
			'storage.googleapis.com'
		])
			expect(is_host_entry(good), good).toBe(true);
		const tenant = new URL('https://evil.s3.us-east-1.amazonaws.com/a.png');
		expect(new RemoteHosts(['*.my-bucket.s3.us-east-1.amazonaws.com']).match(tenant)).toBe(null);
	});

	test('a *. entry over a shared storage or image CDN name (a Vercel Blob store, a Bunny pull zone, an imgix source) is refused; one store of it is not', () => {
		for (const bad of [
			'*.public.blob.vercel-storage.com',
			'*.private.blob.vercel-storage.com',
			'*.blob.vercel-storage.com',
			'*.vercel-storage.com',
			'*.storage.supabase.co',
			'*.nyc3.digitaloceanspaces.com',
			'*.nyc3.cdn.digitaloceanspaces.com',
			'*.githubusercontent.com',
			'*.vusercontent.net',
			'*.trycloudflare.com',
			'*.b-cdn.net',
			'*.imgix.net',
			'*.ufs.sh',
			'*.akamaized.net',
			'*.akamaihd.net',
			'*.global.ssl.fastly.net',
			'*.freetls.fastly.net'
		])
			expect(is_host_entry(bad), bad).toBe(false);
		for (const good of [
			'abc123.public.blob.vercel-storage.com',
			'*.my-zone.b-cdn.net',
			'my-source.imgix.net',
			'my-bucket.nyc3.digitaloceanspaces.com'
		])
			expect(is_host_entry(good), good).toBe(true);
	});

	test('one tenant of a regional storage name stays its own', () => {
		const tenant = new URL('https://evil.s3.us-east-1.amazonaws.com/a.png');
		expect(new RemoteHosts(['*.my-bucket.s3.us-east-1.amazonaws.com']).match(tenant)).toBe(null);
	});

	test('a URL whose host ends in a trailing dot is the host without it', () => {
		const hosts = new RemoteHosts(['*.cdn.example.com', 'images.example.com']);
		expect(hosts.match(new URL('https://a.cdn.example.com./x.png'))).toBe('below');
		expect(hosts.match(new URL('https://images.example.com./x.png'))).toBe('named');
		expect(
			new RemoteHosts(['images.example.com.']).match(new URL('https://images.example.com/x.png'))
		).toBe('named');
	});

	test('the line to add names exactly the refused host', () => {
		expect(entry_for(new URL('https://images.example.com/a.jpg'))).toBe('images.example.com');
		expect(entry_for(new URL('http://127.0.0.1:4100/a.jpg'))).toBe('http://127.0.0.1:4100');
		expect(entry_for(new URL('https://a.example.com:8443/a.jpg'))).toBe('a.example.com:8443');
	});

	const label = fc
		.stringMatching(/^[a-z]([a-z0-9-]{0,8}[a-z0-9])?$/)
		.filter((l) => l[2] !== '-' || l[3] !== '-');
	const name = fc.array(label, { minLength: 2, maxLength: 4 }).map((l) => l.join('.'));

	test('no pattern takes a host outside it (property)', () => {
		fc.assert(
			fc.property(name, name, fc.boolean(), (listed, other, below) => {
				const entry = below ? `*.${listed}` : listed;
				const hosts = new RemoteHosts([entry]);
				const inside = below ? other.endsWith(`.${listed}`) : other === listed;
				expect(hosts.allows(new URL(`https://${other}/a.jpg`))).toBe(inside);
				expect(hosts.allows(new URL(`https://${listed}.${other}/a.jpg`))).toBe(false);
				expect(hosts.allows(new URL(`http://${listed}/a.jpg`))).toBe(false);
			}),
			{ numRuns: 500 }
		);
	});

	test('the remote option is checked: hosts, limits, unknown keys', () => {
		expect(() => check_plugin_options({ remote: { hosts: ['images.example.com'] } })).not.toThrow();
		expect(() => check_plugin_options({ remote: { hosts: [] } })).toThrow(/remote.hosts/);
		expect(() => check_plugin_options({ remote: { hosts: ['*.com'] } })).toThrow(/remote.hosts/);
		expect(() =>
			check_plugin_options({ remote: { hosts: ['a.example.com'], maxBytes: 0 } })
		).toThrow(/remote.maxBytes/);
		expect(() =>
			check_plugin_options({ remote: { hosts: ['a.example.com'], timeout: 1.5 } })
		).toThrow(/remote.timeout/);
		expect(() =>
			check_plugin_options({ remote: { hosts: ['a.example.com'], maxAge: -1 } })
		).toThrow(/remote.maxAge/);
		expect(() => check_plugin_options({ remote: { hosts: ['a.example.com'], maxAge: 0 } })).toThrow(
			/remote.maxAge/
		);
		expect(() =>
			check_plugin_options({ remote: { hosts: ['a.example.com'], domains: [] } })
		).toThrow(/unknown image option 'domains'/);
	});
});

describe('the fetch into the build cache', () => {
	let png: Buffer;
	let server: http.Server;
	let origin = '';
	const asked: string[] = [];

	beforeAll(async () => {
		png = await sharp({
			create: { width: 40, height: 30, channels: 3, background: '#3a6ea5' }
		})
			.png()
			.toBuffer();
		server = http.createServer((req, res) => {
			const url = req.url ?? '/';
			asked.push(`${url} ${req.headers['if-none-match'] ?? ''}`);
			const go = (to: string): void => {
				res.writeHead(302, { location: to });
				res.end();
			};
			if (url === '/a.png') {
				if (req.headers['if-none-match'] === '"v1"') {
					res.writeHead(304);
					res.end();
					return;
				}
				res.writeHead(200, { 'content-type': 'image/png', etag: '"v1"' });
				res.end(png);
			} else if (url === '/hop1') go('/hop2');
			else if (url === '/hop2') go(`${origin}/hop3`);
			else if (url === '/hop3') go('/a.png');
			else if (url === '/out')
				go(`http://localhost:${(server.address() as AddressInfo).port}/a.png`);
			else if (url === '/loop') go('/loop');
			else if (url === '/big') {
				res.writeHead(200, { 'content-type': 'image/png' });
				res.write(Buffer.alloc(600));
				res.write(Buffer.alloc(600));
				res.end();
			} else if (url === '/big-length') {
				res.writeHead(200, { 'content-type': 'image/png', 'content-length': '5000' });
				res.end(Buffer.alloc(5000));
			} else if (url === '/page') {
				res.writeHead(200, { 'content-type': 'text/html' });
				res.end('<p>not an image</p>');
			} else if (url === '/slow') {
				res.writeHead(200, { 'content-type': 'image/png' });
				res.write(png.subarray(0, 10));
			} else {
				res.writeHead(404);
				res.end();
			}
		});
		await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterAll(() => {
		server.closeAllConnections();
		server.close();
	});

	function ask(rel: string, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-remote-'))): Ask {
		return {
			url: `${origin}${rel}`,
			dir,
			where: 'page.ts',
			hosts: new RemoteHosts([origin]),
			limits: { maxBytes: 1000, timeout: 300 }
		};
	}

	test('a first fetch keeps the bytes and their etag, named by the URL', async () => {
		const a = ask('/a.png');
		const file = await fetched_file({ ...a, limits: { maxBytes: 10_000, timeout: 2000 } });
		expect(file).toBe(path.join(a.dir, `${remote_name(a.url)}.png`));
		expect(fs.readFileSync(file).equals(png)).toBe(true);
		expect(
			JSON.parse(fs.readFileSync(path.join(a.dir, `${remote_name(a.url)}.json`), 'utf8'))
		).toEqual({ url: a.url, ext: 'png', etag: '"v1"' });
	});

	test('a second build asks with the etag, and a 304 keeps the copy', async () => {
		const a = { ...ask('/a.png'), limits: { maxBytes: 10_000, timeout: 2000 } };
		await fetched_file(a);
		const mtime = fs.statSync(path.join(a.dir, `${remote_name(a.url)}.png`)).mtimeMs;
		asked.length = 0;
		const file = await fetched_file(a);
		expect(asked).toEqual(['/a.png "v1"']);
		expect(fs.statSync(file).mtimeMs).toBe(mtime);
	});

	test('redirects are followed, each hop checked, at most 3', async () => {
		const a = { ...ask('/hop1'), limits: { maxBytes: 10_000, timeout: 2000 } };
		expect(fs.readFileSync(await fetched_file(a)).equals(png)).toBe(true);
		await expect(fetched_file(ask('/loop'))).rejects.toThrow(/more than 3 redirects/);
	});

	test('a redirect to a host the list does not name fails the build, naming both', async () => {
		const err = await fetched_file(ask('/out')).catch((e: unknown) => e as Error);
		expect(String(err)).toMatch(/image_remote_host/);
		expect(String(err)).toMatch(/\/out' redirects to 'http:\/\/localhost:\d+\/a\.png'/);
		expect(String(err)).toMatch(/Add 'http:\/\/localhost:\d+'/);
	});

	test('a body past maxBytes is dropped, counted as it streams or by its length', async () => {
		await expect(fetched_file(ask('/big'))).rejects.toThrow(/too large/);
		await expect(fetched_file(ask('/big-length'))).rejects.toThrow(/too large/);
	});

	test('an answer that is not an image, or an error status, fails with the reason', async () => {
		await expect(fetched_file(ask('/page'))).rejects.toThrow(
			/not an image: content-type text\/html/
		);
		await expect(fetched_file(ask('/gone'))).rejects.toThrow(
			/\(status 404\)[\s\S]*image_remote_failed/
		);
	});

	test('a host that stops answering fails at the timeout', async () => {
		const at = Date.now();
		await expect(fetched_file(ask('/slow'))).rejects.toThrow(
			/no answer within remote.timeout, 300 ms/
		);
		expect(Date.now() - at).toBeLessThan(2000);
	});

	test('offline with a copy kept: the copy, and image_remote_stale; offline with none: image_remote_failed', async () => {
		const gone = http.createServer((_, res) => {
			res.writeHead(200, { 'content-type': 'image/png' });
			res.end(png);
		});
		await new Promise<void>((done) => gone.listen(0, '127.0.0.1', done));
		const at = `http://127.0.0.1:${(gone.address() as AddressInfo).port}`;
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-remote-'));
		const a: Ask = {
			url: `${at}/a.png`,
			dir,
			where: 'page.ts',
			hosts: new RemoteHosts([at]),
			limits: { maxBytes: 10_000, timeout: 2000 }
		};
		const file = await fetched_file(a);
		await new Promise<void>((done) => gone.close(() => done()));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			expect(await fetched_file(a)).toBe(file);
			expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(
				/image_remote_stale|could not ask for the image/
			);
		} finally {
			warn.mockRestore();
		}
		await expect(
			fetched_file({ ...a, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'og-remote-')) })
		).rejects.toThrow(/\(no answer: ECONNREFUSED\)[\s\S]*image_remote_failed/);
	});

	test('in dev the endpoint reads a remote original only from the remote folder, by its hashed name', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-remote-root-'));
		const remote = path.join(root, 'node_modules/.ogygia/image/remote');
		fs.mkdirSync(remote, { recursive: true });
		const name = remote_name('https://images.example.com/a.jpg');
		fs.writeFileSync(path.join(remote, `${name}.jpg`), png);
		fs.writeFileSync(path.join(remote, 'other.jpg'), png);
		const tail = `node_modules/.ogygia/image/remote/${name}.jpg`;
		expect(is_remote(root, remote, tail)).toBe(true);
		expect(is_remote(root, remote, `@fs${path.join(remote, `${name}.jpg`)}`)).toBe(true);
		expect(is_remote(root, remote, 'node_modules/.ogygia/image/remote/other.jpg')).toBe(false);
		expect(
			is_remote(root, remote, `node_modules/.ogygia/image/remote/${remote_name('x')}.jpg`)
		).toBe(false);
		expect(is_remote(root, remote, `node_modules/.ogygia/image/remote/../remote/${name}.jpg`)).toBe(
			true
		);
		expect(is_remote(root, remote, `node_modules/.ogygia/image/${name}.jpg`)).toBe(false);
		expect(is_remote(root, '', tail)).toBe(false);
	});

	test('one process asks each URL once, however many modules name it', async () => {
		const images = new RemoteImages({ hosts: [origin], maxBytes: 10_000, timeout: 2000 });
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-remote-'));
		asked.length = 0;
		const [a, b] = await Promise.all([
			images.file(dir, `${origin}/a.png`, 'a.ts'),
			images.file(dir, `${origin}/a.png`, 'b.ts')
		]);
		await images.file(dir, `${origin}/a.png`, 'c.ts');
		expect(a).toBe(b);
		expect(asked).toEqual(['/a.png ']);
		expect(images.names()).toEqual([remote_name(`${origin}/a.png`)]);
	});
});
