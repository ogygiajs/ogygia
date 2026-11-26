// With an encoder's own links (`cloudflare()`, `vercel()`), a `remoteImage()` on a host
// `image({ remote: { hosts } })` does not list gets no link the CDN would fetch: it is named by the
// endpoint, which refuses it (404, `image_remote_refused`) the same way it does for `sharp()`.
import { expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';

const links = vi.hoisted(() => ({ kind: 'cloudflare' as 'cloudflare' | 'vercel' }));
vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
});

vi.mock('virtual:ogygia-image/sources', () => ({ default: {}, remote: [] }));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));
vi.mock('$app/server', () => ({ read: () => new Response(new Uint8Array()) }));
vi.mock('virtual:ogygia-image/remote', () => ({
	remote: { hosts: ['https://cms.example.com'], maxBytes: 100_000, timeout: 400, maxAge: 60 },
	transport: () => Promise.reject(new Error('no fetch in this test'))
}));
vi.mock('virtual:ogygia-image/namer', async () => {
	const { cloudflare_link } = await import('../src/encoders/cloudflare.ts');
	const { vercel_link } = await import('../src/encoders/vercel.ts');
	return {
		name: (r: Parameters<typeof cloudflare_link>[0]) =>
			links.kind === 'cloudflare'
				? cloudflare_link(r)
				: vercel_link(r, { sizes: [640, 1280], qualities: null })
	};
});

const { default: server } = await import('../src/server.ts');
const { mint } = await import('../src/recipe.ts');
const { remoteImage } = await import('../src/remote-image.ts');
const { ctx } = startPlugin(server, { name: '@ogygia/image' });

const recipe = (url: string) => {
	const d = remoteImage(url, { width: 1280, height: 720 });
	return {
		id: d.id,
		src: d.src,
		width: 640,
		height: 360,
		format: 'webp' as const,
		from: 'remote' as const
	};
};

for (const kind of ['cloudflare', 'vercel'] as const)
	test(`with ${kind}() links, a remote image on an unlisted host gets the endpoint's URL, which refuses it with a code`, async () => {
		links.kind = kind;
		const listed = mint(recipe('https://cms.example.com/a.jpg'), false)!;
		expect(listed).toMatch(kind === 'cloudflare' ? /^\/cdn-cgi\/image\// : /^\/_vercel\/image\?/);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const url = mint(recipe(`https://evil.example.org/${kind}.jpg`), false)!;
		expect(url).toMatch(/^\/__ogygia__\/i\//);
		const res = (await server.request!(ctx(new Request(new URL(url, 'http://localhost')))))!;
		expect(res.status).toBe(404);
		expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
			expect.stringMatching(/image_remote_refused[\s\S]*evil\.example\.org/)
		]);
		warn.mockRestore();
	});
