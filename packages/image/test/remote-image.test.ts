// `remoteImage()`'s descriptor, its recipes' `.remote/` tail, the sync SHA-256 its id is made with,
// and which addresses a host listed only by `*.` may never resolve to.
import crypto from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { DEFAULT_BREAKPOINTS, type RenderConfig } from '../src/config.ts';
import { cloudflare_link } from '../src/encoders/cloudflare.ts';
import { lay_out } from '../src/layout.ts';
import { recipe_path, recipe_tail, remote_of_tail, type Recipe } from '../src/recipe.ts';
import { remoteImage, remote_id } from '../src/remote-image.ts';
import { private_address, RemoteHosts } from '../src/remote-hosts.ts';
import { connect_lookup } from '../src/remote-node.ts';
import { sha256 } from '../src/sha256.ts';

const CFG: RenderConfig = {
	formats: ['avif', 'webp'],
	breakpoints: DEFAULT_BREAKPOINTS,
	presets: {},
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: false
};

describe('remoteImage()', () => {
	test('a descriptor of the URL: id r and a hash of the URL and version, its box, its format by extension, no placeholder', () => {
		const d = remoteImage('https://images.example.com/a/hero.PNG?w=1', {
			width: 2400,
			height: 1600,
			alt: 'A hero'
		});
		expect(d).toEqual({
			id: remote_id('https://images.example.com/a/hero.PNG?w=1', undefined),
			src: 'https://images.example.com/a/hero.PNG?w=1',
			width: 2400,
			height: 1600,
			format: 'png',
			from: 'remote',
			alt: 'A hero'
		});
		expect(d.id).toMatch(/^r[\w-]{32}$/);
		expect(remoteImage('https://images.example.com/x', { width: 1, height: 1 }).format).toBe(
			'jpeg'
		);
	});

	test('another URL or another version is another source; the same URL written another way is the same', () => {
		const at = (url: string, version?: string | number) =>
			remoteImage(url, { width: 10, height: 10, ...(version !== undefined ? { version } : {}) }).id;
		const a = at('https://images.example.com/a.jpg');
		expect(at('https://IMAGES.example.com/a.jpg')).toBe(a);
		expect(at('https://images.example.com/b.jpg')).not.toBe(a);
		expect(at('https://images.example.com/a.jpg', 2)).not.toBe(a);
		expect(at('https://images.example.com/a.jpg', '2')).toBe(
			at('https://images.example.com/a.jpg', 2)
		);
	});

	test('refuses what it cannot name: no http(s) URL, a user in it, a box that is not whole pixels, an alt or version of another kind', () => {
		const bad: [unknown, unknown][] = [
			['/local.jpg', { width: 1, height: 1 }],
			['data:image/png;base64,AAAA', { width: 1, height: 1 }],
			['ftp://images.example.com/a.jpg', { width: 1, height: 1 }],
			['https://u:p@images.example.com/a.jpg', { width: 1, height: 1 }],
			['https://images.example.com/a.jpg', { width: 0, height: 1 }],
			['https://images.example.com/a.jpg', { width: 1.5, height: 1 }],
			['https://images.example.com/a.jpg', { width: 1, height: 100_000 }],
			['https://images.example.com/a.jpg', { width: 1 }],
			['https://images.example.com/a.jpg', { width: 1, height: 1, alt: 3 }],
			['https://images.example.com/a.jpg', { width: 1, height: 1, version: {} }],
			['https://images.example.com/a.jpg', null]
		];
		for (const [url, options] of bad)
			expect(
				() => remoteImage(url as string, options as never),
				JSON.stringify([url, options])
			).toThrow(/image_remote_invalid/);
	});

	test('its recipes name the URL in a .remote/ tail that reads back as the URL, and no other tail does', () => {
		const recipes: Recipe[] = [];
		lay_out(
			remoteImage('https://images.example.com/a b.jpg?v=1#x', { width: 800, height: 600 }),
			{ width: 400 },
			CFG,
			(r) => {
				recipes.push(r);
				return '';
			}
		);
		expect(recipes.length).toBeGreaterThan(0);
		for (const r of recipes) {
			expect(r.from).toBe('remote');
			const tail = recipe_tail(r, ['']);
			expect(tail).toMatch(/^\.remote\/[\w-]+$/);
			expect(remote_of_tail(tail)?.href).toBe('https://images.example.com/a%20b.jpg?v=1#x');
			expect(recipe_path(r, tail)).toMatch(/^r[\w-]{32}-\d+x\d+\/\.remote\/[\w-]+\.(avif|webp)$/);
		}
		const b64 = (s: string) => Buffer.from(s).toString('base64url');
		expect(remote_of_tail(`.remote/${b64('file:///etc/passwd')}`)).toBeNull();
		expect(remote_of_tail(`.remote/${b64('HTTPS://images.example.com/a.jpg')}`)).toBeNull();
		expect(remote_of_tail(`.remote/${b64('https://images.example.com/a.jpg')}/x`)).toBeNull();
		expect(remote_of_tail('.remote/!!')).toBeNull();
		expect(remote_of_tail('_app/immutable/assets/a.png')).toBeNull();
	});

	test("with cloudflare() links, a remote image's link names its whole URL after the options", () => {
		const recipes: Recipe[] = [];
		lay_out(
			remoteImage('https://images.example.com/a.jpg', { width: 800, height: 600 }),
			{ width: 400 },
			CFG,
			(r) => {
				recipes.push(r);
				return '';
			}
		);
		expect(cloudflare_link(recipes[0]!)).toMatch(
			/^\/cdn-cgi\/image\/width=\d+,height=\d+,fit=crop,quality=\d+,format=avif\/https:\/\/images\.example\.com\/a\.jpg$/
		);
	});
});

describe('sha256', () => {
	test('is SHA-256 (property, against node:crypto)', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
				expect(Buffer.from(sha256(bytes)).toString('hex')).toBe(
					crypto.createHash('sha256').update(bytes).digest('hex')
				);
			}),
			{ numRuns: 300 }
		);
	});
});

describe('private addresses', () => {
	test('loopback, private, link-local (cloud metadata), shared, reserved and multicast addresses are private; a public one is not', () => {
		for (const a of [
			'127.0.0.1',
			'10.1.2.3',
			'172.16.0.1',
			'172.31.255.255',
			'192.168.1.1',
			'169.254.169.254',
			'100.64.0.1',
			'0.0.0.0',
			'224.0.0.1',
			'255.255.255.255',
			'::1',
			'::',
			'fe80::1%en0',
			'fd00::1',
			'fc00::1',
			'ff02::1',
			'::ffff:127.0.0.1',
			'::ffff:7f00:1',
			'64:ff9b::a9fe:a9fe',
			'2002:c0a8:0101::1',
			'2001:db8::1',
			'not an address'
		])
			expect(private_address(a), a).toBe(true);
		for (const a of [
			'93.184.216.34',
			'8.8.8.8',
			'172.32.0.1',
			'100.128.0.1',
			'2606:4700::1111',
			'::ffff:8.8.8.8',
			'64:ff9b::808:808',
			'2002:0808:0808::1'
		])
			expect(private_address(a), a).toBe(false);
	});

	const v4 = fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map((p) => p.join('.'));

	test('an IPv4 address and the IPv6 addresses that carry it (mapped, NAT64, 6to4) are one answer (property)', () => {
		fc.assert(
			fc.property(v4, (a) => {
				const [w, x, y, z] = a.split('.').map(Number) as [number, number, number, number];
				const hex = (h: number, l: number) => ((h << 8) | l).toString(16);
				const want = private_address(a);
				expect(private_address(`::ffff:${a}`)).toBe(want);
				expect(private_address(`64:ff9b::${hex(w, x)}:${hex(y, z)}`)).toBe(want);
				expect(private_address(`2002:${hex(w, x)}:${hex(y, z)}::1`)).toBe(want);
			}),
			{ numRuns: 500 }
		);
	});

	test('a connection to a host listed only by *. gets its addresses only when every one is public; a named host gets any', () => {
		const answer =
			(addresses: string[]) =>
			(
				_h: string,
				_o: unknown,
				done: (e: null, a: { address: string; family: number }[]) => void
			) =>
				done(
					null,
					addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
				);
		const ask = (addresses: string[], public_only: boolean, all: boolean) =>
			new Promise<unknown[]>((resolve) =>
				connect_lookup(answer(addresses), public_only)('a.cdn.example.com', { all }, (...args) =>
					resolve(args)
				)
			);
		return Promise.all([
			ask(['93.184.216.34'], true, false).then((r) =>
				expect(r).toEqual([null, '93.184.216.34', 4])
			),
			ask(['93.184.216.34', '10.0.0.1'], true, true).then((r) =>
				expect(String(r[0])).toMatch(/resolves to 10\.0\.0\.1, not a public address/)
			),
			ask(['10.0.0.1'], false, true).then((r) =>
				expect(r).toEqual([null, [{ address: '10.0.0.1', family: 4 }]])
			)
		]);
	});

	test('a *. entry never matches an address; only an entry that names the address does', () => {
		const hosts = new RemoteHosts(['*.example.com', 'http://127.0.0.1:4176']);
		expect(hosts.match(new URL('https://a.example.com/x.jpg'))).toBe('below');
		expect(hosts.match(new URL('http://127.0.0.1:4176/x.jpg'))).toBe('named');
		expect(hosts.match(new URL('http://127.0.0.2:4176/x.jpg'))).toBeNull();
		expect(
			new RemoteHosts(['*.example.com', 'a.example.com']).match(new URL('https://a.example.com/'))
		).toBe('named');
	});
});
