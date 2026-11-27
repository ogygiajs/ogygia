// The build's end: every file the build makes (a warmed preset's, a prerendered page's) is written
// under the app folder by its recipe, and each prerendered page's marked URLs point at them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { card_id } from '../src/card.ts';
import type { RenderConfig } from '../src/config.ts';
import { build_handoff } from '../src/handoff.ts';
import { b64url_encode, recipe_path, recipe_tail, type Recipe } from '../src/recipe.ts';
import { remoteImage } from '../src/remote-image.ts';
import { note_built, note_origin } from '../src/store.ts';
import { handoff_for, write_built } from '../src/vite/build-files.ts';
import { id_of, make_images } from './fixtures.ts';

vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
});

const CFG: RenderConfig = {
	formats: ['avif', 'webp'],
	breakpoints: [320, 640],
	presets: { thumb: { width: 100, aspect: '1/1', formats: ['webp'] } },
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: true
};

let jpg = '';
let id = '';
beforeAll(async () => {
	jpg = (await make_images()).jpg;
	id = await id_of(jpg);
});

const random_digest = (): string => crypto.randomUUID();

function output(page: string): string {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-out-'));
	fs.mkdirSync(path.join(out, 'client', '_app', 'immutable', 'assets'), { recursive: true });
	fs.copyFileSync(jpg, path.join(out, 'client', '_app', 'immutable', 'assets', 'h.Ab12.jpg'));
	fs.mkdirSync(path.join(out, 'prerendered', 'pages'), { recursive: true });
	fs.writeFileSync(path.join(out, 'prerendered', 'pages', 'index.html'), page);
	return out;
}

test("a prerendered page's files are written under the app folder, and its marked URLs name them", async () => {
	const handoff = await handoff_for(true);
	note_built(handoff.minted, `${id}-64x43/_app/immutable/assets/h.Ab12.jpg.webp`);
	const marked = `${handoff.mark}/_app/immutable/og/${id}-64x43.webp`;
	const out = output(`<img src="${marked}" style="background:url(${marked})">`);
	await write_built(handoff, CFG, [], out);
	const file = path.join(out, 'client', '_app', 'immutable', 'og', `${id}-64x43.webp`);
	const meta = await sharp(fs.readFileSync(file)).metadata();
	expect([meta.format, meta.width, meta.height]).toEqual(['webp', 64, 43]);
	expect(fs.readFileSync(path.join(out, 'prerendered', 'pages', 'index.html'), 'utf8')).toBe(
		`<img src="/_app/immutable/og/${id}-64x43.webp" style="background:url(/_app/immutable/og/${id}-64x43.webp)">`
	);
});

test('the build hands what it renders after its end (an SPA fallback) the files it wrote, with no notes and no mark; the next build starts a new run', async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = await handoff_for(true);
	const out = output('<p>no images</p>');
	await write_built(handoff, CFG, [], out);
	const after = build_handoff()!;
	expect(after).toMatchObject({ minted: '', mark: '', written: path.join(out, 'client', '_app') });
	const next = await handoff_for(true);
	expect(next.minted).not.toBe('');
	expect(next.minted).not.toBe(handoff.minted);
	expect(next.written).toBe('');
});

test("a warmed preset's files are written under the app folder by their recipe", async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = await handoff_for(true);
	const out = output('<p>no images</p>');
	const desc = { id, width: 2400, height: 1600, format: 'jpeg' as const };
	await write_built(handoff, CFG, [{ file: jpg, desc, originals: {}, presets: ['thumb'] }], out);
	const made = fs.readdirSync(path.join(out, 'client', '_app', 'immutable', 'og')).sort();
	expect(made).toEqual([`${id}-100x100.webp`, `${id}-200x200.webp`]);
});

test("warming a preset warms its twins: a dark file's files are made from that file, and an art crop's from the source", async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = await handoff_for(true);
	const out = output('<p>no images</p>');
	const dark = path.join(path.dirname(jpg), 'dark-twin.jpg');
	await sharp(jpg).negate().toFile(dark);
	const dark_id = await id_of(dark);
	const meta = await sharp(jpg).metadata();
	const shape = { width: meta.width, height: meta.height, format: 'jpeg' as const };
	const desc = {
		id,
		...shape,
		twins: [
			{
				media: '(prefers-color-scheme: dark)',
				theme: 'dark' as const,
				of: { id: dark_id, src: '', ...shape }
			}
		]
	};
	const cfg: RenderConfig = {
		...CFG,
		presets: {
			thumb: { ...CFG.presets.thumb, art: [{ media: '(max-width: 600px)', aspect: '2/1' }] }
		}
	};
	await write_built(
		handoff,
		cfg,
		[{ file: jpg, desc, originals: { [dark_id]: dark }, presets: ['thumb'] }],
		out
	);
	const made = fs.readdirSync(path.join(out, 'client', '_app', 'immutable', 'og')).sort();
	expect(made).toEqual(
		[
			`${id}-100x100.webp`,
			`${id}-200x200.webp`,
			`${id}-100x50.webp`,
			`${id}-200x100.webp`,
			`${dark_id}-100x100.webp`,
			`${dark_id}-200x200.webp`,
			`${dark_id}-100x50.webp`,
			`${dark_id}-200x100.webp`
		].sort()
	);
});

test('a page that changed a marked URL before writing it (escaped it) fails the build with a code', async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = await handoff_for(true);
	note_built(handoff.minted, `${id}-64x43/_app/immutable/assets/h.Ab12.jpg.webp`);
	const marked = `${handoff.mark}/_app/immutable/og/${id}-64x43.webp`;
	const out = output(`<a href="/share?image=${encodeURIComponent(marked)}">share</a>`);
	await expect(write_built(handoff, CFG, [], out)).rejects.toMatchObject({
		code: 'image_mark_left'
	});
});

test('a file the build cannot make fails it with a code that names the source file, not only the made name', async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = await handoff_for(true);
	const out = output('<p>no images</p>');
	const broken = path.join(out, 'client', '_app', 'immutable', 'assets', 'broken.Cd34.jpg');
	fs.writeFileSync(broken, 'not a jpeg');
	const broken_id = await id_of(broken);
	note_built(handoff.minted, `${broken_id}-64x43/_app/immutable/assets/broken.Cd34.jpg.webp`);
	await expect(write_built(handoff, CFG, [], out)).rejects.toMatchObject({
		code: 'image_unsettled',
		message: expect.stringContaining('_app/immutable/assets/broken.Cd34.jpg')
	});
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const warmed = await handoff_for(true);
	const desc = { id: broken_id, width: 2400, height: 1600, format: 'jpeg' as const };
	await expect(
		write_built(
			warmed,
			CFG,
			[{ file: broken, desc, originals: {}, presets: ['thumb'] }],
			output('')
		)
	).rejects.toMatchObject({ message: expect.stringContaining(broken) });
});

test('a build with many files it cannot make names every one, not only the first', async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});
	const handoff = await handoff_for(true);
	const out = output('<p>no images</p>');
	for (const name of ['one.Aa11.jpg', 'two.Bb22.jpg']) {
		const broken = path.join(out, 'client', '_app', 'immutable', 'assets', name);
		fs.writeFileSync(broken, `not a jpeg ${name}`);
		note_built(handoff.minted, `${await id_of(broken)}-64x43/_app/immutable/assets/${name}.webp`);
	}
	const thrown = await write_built(handoff, CFG, [], out).catch((e: Error) => e.message);
	const said = [String(thrown), ...error.mock.calls.map((c) => String(c[0]))].join('\n');
	error.mockRestore();
	expect(said).toContain('one.Aa11.jpg');
	expect(said).toContain('two.Bb22.jpg');
});

/** A prerendered page holding `page(marked)`, `marked` the marked URL of a 64 × 43 file of the
 *  test's source, after the build's end, with `origin` noted as Kit's prerender origin. */
async function written(page: (marked: string) => string, origin?: string): Promise<string> {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = await handoff_for(true);
	note_built(handoff.minted, `${id}-64x43/_app/immutable/assets/h.Ab12.jpg.webp`);
	if (origin !== undefined) note_origin(handoff.minted, origin);
	const out = output(page(`${handoff.mark}/_app/immutable/og/${id}-64x43.webp`));
	await write_built(handoff, CFG, [], out);
	return fs.readFileSync(path.join(out, 'prerendered', 'pages', 'index.html'), 'utf8');
}

test("a marked URL made absolute against the page's URL (an og:image, a feed's enclosure) names the file at Kit's prerender origin", async () => {
	const html = await written((marked) => {
		const share = new URL(marked, 'https://example.com/blog/a').href;
		const enclosure = new URL(marked, 'http://example.com/').href;
		return `<meta property="og:image" content="${share}"><enclosure url="${enclosure}"/>`;
	}, 'https://example.com');
	const file = `https://example.com/_app/immutable/og/${id}-64x43.webp`;
	expect(html).toBe(`<meta property="og:image" content="${file}"><enclosure url="${file}"/>`);
});

test("a marked URL made absolute while Kit's prerender origin is its default fails the build with a code that says to set it", async () => {
	for (const origin of [undefined, 'http://sveltekit-prerender'])
		await expect(
			written((marked) => `<meta content="${new URL(marked, 'https://example.com').href}">`, origin)
		).rejects.toMatchObject({
			code: 'image_mark_left',
			message: expect.stringMatching(/prerender\.origin/)
		});
});

test('a marked URL after a colon that starts no URL (a CSS custom property) is only unmarked', async () => {
	const html = await written(
		(marked) => `<div style="--src:${marked}"></div>`,
		'https://example.com'
	);
	expect(html).toBe(`<div style="--src:/_app/immutable/og/${id}-64x43.webp"></div>`);
});

test("a prerendered page's remoteImage() is fetched by the build, its files named by the bytes it got, and every name of them in the pages rewritten to that", async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = await handoff_for(true);
	const url = 'https://images.example.com/hero.jpg';
	const cover = remoteImage(url, { width: 2400, height: 1600 });
	const recipe: Recipe = { ...cover, width: 64, height: 43, format: 'webp', from: 'remote' };
	note_built(handoff.minted, recipe_path(recipe, recipe_tail(recipe, [''])));
	const marked = `${handoff.mark}/_app/immutable/og/${cover.id}-64x43.webp`;
	const out = output(`<img src="${marked}"><script>{"id":"${cover.id}"}</script>`);
	const asked: string[] = [];
	await write_built(handoff, CFG, [], out, (at) => {
		asked.push(at);
		return Promise.resolve(jpg);
	});
	expect(asked).toEqual([url]);
	const made = fs.readdirSync(path.join(out, 'client', '_app', 'immutable', 'og'));
	expect(made).toEqual([`${id}-64x43.webp`]);
	expect(fs.readFileSync(path.join(out, 'prerendered', 'pages', 'index.html'), 'utf8')).toBe(
		`<img src="/_app/immutable/og/${id}-64x43.webp"><script>{"id":"${cover.id}"}</script>`
	);
});

test("a prerendered page's remoteImage() in a build with no image({ remote }) fails it, naming the host to list", async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = await handoff_for(true);
	const cover = remoteImage('https://images.example.com/hero.jpg', { width: 2400, height: 1600 });
	const recipe: Recipe = { ...cover, width: 64, height: 43, format: 'webp', from: 'remote' };
	note_built(handoff.minted, recipe_path(recipe, recipe_tail(recipe, [''])));
	await expect(write_built(handoff, CFG, [], output('<p></p>'))).rejects.toMatchObject({
		code: 'image_unsettled',
		message: expect.stringMatching(
			/https:\/\/images\.example\.com\/hero\.jpg[\s\S]*images\.example\.com/
		)
	});
});

describe('a prerendered card that shows a remote image', () => {
	const url = 'https://images.example.com/mark.png';
	const json = '{"t":1}';
	const card_tail = `RemoteCard000000/${b64url_encode(json)}`;
	const at = { file: '' };
	const solid = async (background: string): Promise<string> => {
		const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-mark-')), 'm.png');
		await sharp({ create: { width: 64, height: 32, channels: 3, background } })
			.png()
			.toFile(file);
		return file;
	};

	async function build(card_id_now: string): Promise<{ name: string; color: number[] }> {
		delete process.env.__OGYGIA_IMAGE_BUILD;
		const handoff = await handoff_for(true);
		const recipe: Recipe = {
			id: card_id_now,
			src: '',
			width: 64,
			height: 32,
			format: 'png',
			from: 'card',
			card: card_tail
		};
		note_built(handoff.minted, recipe_path(recipe, recipe_tail(recipe, [''])));
		const out = output(`<img src="${handoff.mark}/_app/immutable/og/${card_id_now}-64x32.png">`);
		await write_built(
			handoff,
			CFG,
			[],
			out,
			() => Promise.resolve(at.file),
			async (_tail: string, _id: string, remote?: (url: URL) => Promise<Uint8Array>) =>
				remote ? remote(new URL(url)) : new Uint8Array(fs.readFileSync(at.file))
		);
		const page = fs.readFileSync(path.join(out, 'prerendered', 'pages', 'index.html'), 'utf8');
		const name = /\/_app\/immutable\/og\/(c[\w-]+)-64x32\.png/.exec(page)![1]!;
		const file = path.join(out, 'client', '_app', 'immutable', 'og', `${name}-64x32.png`);
		const { data } = await sharp(fs.readFileSync(file)).raw().toBuffer({ resolveWithObject: true });
		return { name, color: [...data.subarray(0, 3)] };
	}

	test("is named by the bytes it drew: when the host's image changes, the next (warm) build writes a new file, never the old picture under the old name", async () => {
		const id = card_id({ digest: random_digest(), width: 64, height: 32 }, json);
		at.file = await solid('#ff0000');
		const first = await build(id);
		expect(first.color).toEqual([255, 0, 0]);
		at.file = await solid('#0000ff');
		const second = await build(id);
		expect(second.color).toEqual([0, 0, 255]);
		expect(second.name).not.toBe(first.name);
		at.file = await solid('#0000ff');
		expect((await build(id)).name, 'the same bytes name the same file').toBe(second.name);
	});
});
