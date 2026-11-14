// JUMPSTART: the committed fixture apps built through their normal `vite build` with and without
// jumpstart(), on SvelteKit 2 and 3. Pages are served the same with it (the response mark and hole
// addresses aside: random or clock-signed by design); the server build has the research's `split`
// shape (internal/notes/design/server-chunks.md); `external` keeps a package out; dev is untouched;
// an app with no regions builds. No browser: every check reads the wire or the build's files, so it
// runs in the Chromium job only.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@ogygia/tooling/e2e';
import { Fixture, type Variant } from './fixture.ts';
import { MANY } from './generate.ts';

const READS_FILE = 'jumpstart-e2e-reads-file';
const OFF: Variant = { jumpstart: false };
const ON: Variant = { jumpstart: true, external: [READS_FILE] };
const PAGES = ['/', '/about', '/p/1', '/p/3', '/p/7', '/p/42', '/inline', '/hole', '/file'];
const BLOCK_MARK_G = /data-block="(B\d{3})"/g;
const REGIONS_CHUNK = 'chunks/regions-registry.js';
const SERVER_CHUNK = 'chunks/server.js';

test.describe.configure({ mode: 'serial' });
test.skip(({ browserName }) => browserName !== 'chromium', 'no browser: one engine is enough');

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');

for (const [kit, name] of [
	['2', 'app'],
	['3', 'app-kit3']
] as const)
	test.describe(`SvelteKit ${kit}`, () => {
		const app = new Fixture(name);
		const built: Record<'off' | 'on', { server: string; log: string; pages: string[] }> = {
			off: { server: '', log: '', pages: [] },
			on: { server: '', log: '', pages: [] }
		};

		test.beforeAll(async () => {
			test.setTimeout(600_000);
			for (const [key, v] of [
				['off', OFF],
				['on', ON]
			] as const) {
				const b = await app.build(v);
				expect(b.ok, b.log).toBe(true);
				await app.preview(v);
				const pages: string[] = [];
				for (const p of PAGES) pages.push(await app.page(p));
				await app.stop();
				built[key] = { server: b.server, log: b.log, pages };
			}
		});
		test.afterAll(() => app.stop());

		test('every page, and the hole it asks for, is served byte for byte as without jumpstart', () => {
			for (const [i, p] of PAGES.entries()) {
				expect(built.on.pages[i], p).toBe(built.off.pages[i]);
				expect(built.off.pages[i], p).toMatch(/^200\n/);
			}
			expect(built.off.pages[PAGES.indexOf('/hole')]).toContain('Hello, reader');
		});

		test('the server build is a few files: the framework and dependencies in one, the registry in another', () => {
			const off = Fixture.js_files(built.off.server);
			const on = Fixture.js_files(built.on.server);
			expect(on).toContain(SERVER_CHUNK);
			expect(on).toContain(REGIONS_CHUNK);
			expect(on.length).toBeLessThan(off.length / 2);
			expect(off).not.toContain(REGIONS_CHUNK);
		});

		test("the registry's chunk holds every block, and nothing a Svelte module marks or the framework", () => {
			const regions = read(built.on.server, REGIONS_CHUNK);
			const blocks = new Set([...regions.matchAll(BLOCK_MARK_G)].map((m) => m[1]));
			expect(blocks.size).toBe(24);
			expect(regions).not.toContain('class="inline"');
			expect(regions).not.toContain('Hello, ');
			const server = read(built.on.server, SERVER_CHUNK);
			expect(server).not.toMatch(BLOCK_MARK_G);
			const imports_many = Fixture.js_files(built.on.server).filter((f) =>
				read(built.on.server, f).includes('from "jumpstart-e2e-many-files"')
			);
			expect(imports_many, 'the 120-file dependency is bundled in').toEqual([]);
			expect(server).toContain('jumpstart-e2e-many-files/f000.js');
		});

		test('a light page never loads the registry chunk; the CMS page loads it and a handful of files', async () => {
			const page = (dir: string, route: string) =>
				path.join(dir, 'entries/pages', route, '_page.svelte.js');
			const light = read(built.on.server, 'entries/pages/about/_page.svelte.js');
			expect(light).not.toContain('regions-registry');
			const inline = read(built.on.server, 'entries/pages/inline/_page.svelte.js');
			expect(inline).not.toContain('regions-registry');
			expect(inline, 'a util the registry shares with the inline region').toContain(
				'regions-shared'
			);
			const cms_off = await Fixture.files_loaded(page(built.off.server, 'p/_n_'));
			const cms_on = await Fixture.files_loaded(page(built.on.server, 'p/_n_'));
			expect(cms_off).toBeGreaterThan(MANY);
			expect(cms_on).toBeLessThanOrEqual(6);
		});

		test('the build says, in one coded line, what stayed outside the bundle and why', () => {
			expect(built.on.log).toContain(
				`jumpstart: 1 outside the server bundle: ${READS_FILE} (jumpstart({ external }))`
			);
			expect(built.on.log).toContain('https://ogygiajs.dev/e/jumpstart_external');
			expect(built.off.log).not.toContain('jumpstart:');
		});
	});

test.describe('SvelteKit 2, the escape hatch, dev and an app with no regions', () => {
	test('a dependency that reads a file beside itself breaks bundled, and works listed in external', async () => {
		test.setTimeout(300_000);
		const app = new Fixture('app');
		const bundled = await app.build({ jumpstart: true });
		expect(bundled.ok).toBe(false);
		expect(bundled.log).toMatch(/ENOENT[^\n]*message\.txt/);
		const kept = await app.build(ON);
		expect(kept.ok, kept.log).toBe(true);
		const imports = Fixture.js_files(kept.server).some((f) =>
			read(kept.server, f).includes(`from "${READS_FILE}"`)
		);
		expect(imports).toBe(true);
	});

	test('dev is untouched: the dev server serves every page as without jumpstart', async () => {
		test.setTimeout(300_000);
		const app = new Fixture('app');
		const pages: string[][] = [];
		try {
			for (const v of [OFF, ON]) {
				await app.dev(v);
				const got: string[] = [];
				for (const p of PAGES) got.push(await app.page(p));
				pages.push(got);
				await app.stop();
			}
		} finally {
			await app.stop();
		}
		for (const [i, p] of PAGES.entries()) expect(pages[1]![i], p).toBe(pages[0]![i]);
	});

	test('an app with no regions builds with no registry chunk, its pages the same', async () => {
		test.setTimeout(300_000);
		const app = new Fixture('plain');
		const got: string[][] = [];
		const files: string[][] = [];
		try {
			for (const v of [OFF, { jumpstart: true }]) {
				const b = await app.build(v);
				expect(b.ok, b.log).toBe(true);
				files.push(Fixture.js_files(b.server));
				if (v.jumpstart) expect(b.log).toContain('every dependency is inside the server bundle');
				await app.preview(v);
				got.push([await app.page('/'), await app.page('/about')]);
				await app.stop();
			}
		} finally {
			await app.stop();
		}
		expect(got[1]).toEqual(got[0]);
		expect(files[1]).toContain(SERVER_CHUNK);
		expect(files[1]!.some((f) => f.includes('regions-'))).toBe(false);
	});
});
