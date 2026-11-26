// Share cards: a card's props (JSON only, small, one text per value), its id and its recipes' `.card/`
// tail, the descriptor it mints, the HTML it draws from (text decoded after parsing), satori's
// refusals as `image_card_css`, the fonts it reads, and the dev rule on share image formats.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import sharp from 'sharp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import { card, card_id, card_json, PROPS_MAX, type CardSpec } from '../src/card.ts';
import { card_in_browser } from '../src/card-browser.ts';
import { card_png, card_tree, decode_entities } from '../src/cards/engine.ts';
import {
	card_of_tail,
	mint,
	parse_recipe,
	recipe_head,
	recipe_path,
	recipe_tail,
	set_minter,
	type Recipe
} from '../src/recipe.ts';
import { unshown_share_images } from '../src/share-rule.ts';
import { font_face, FontUnreadable } from '../src/vite/font-face.ts';
import { is_card_component, with_injected_css } from '../src/vite/card.ts';

const MONO = createRequire(import.meta.url).resolve(
	'@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'
);
const MONO_WOFF2 = MONO.replace(/\.woff$/, '.woff2');

function bytes_of(file: string): ArrayBuffer {
	const b = fs.readFileSync(file);
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function spec_of(html: (props: Record<string, unknown>) => string): CardSpec {
	return {
		card: 'TestCard00000000',
		file: 'src/lib/Card.svelte',
		digest: 'd1',
		width: 600,
		height: 315,
		fonts: [{ name: 'JetBrains Mono', weight: 500, style: 'normal', src: '/font.woff' }],
		html: (props) => Promise.resolve(html(props))
	};
}

afterEach(() => set_minter(null));

describe('props', () => {
	test('the same props written in any key order are one JSON text, one id and one tail', () => {
		const a = card_json('c', { title: 'A', meta: { b: 1, a: [true, null] } });
		const b = card_json('c', { meta: { a: [true, null], b: 1 }, title: 'A' });
		expect(a).toBe(b);
		expect(a).toBe('{"meta":{"a":[true,null],"b":1},"title":"A"}');
		expect(card_id({ digest: 'd', width: 1, height: 1 }, a)).toMatch(/^c[\w-]{32}$/);
	});

	test('any JSON object reads back from its text as itself', () => {
		fc.assert(
			fc.property(
				fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 4 }),
				(props) => {
					const json = card_json('c', props);
					expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(props)));
				}
			),
			{ numRuns: 200 }
		);
	});

	test('props that are not JSON, or past the size a URL carries, are image_card_props', () => {
		const bad: unknown[] = [
			null,
			'title',
			[1],
			{ when: new Date(0) },
			{ n: Number.NaN },
			{ n: Infinity },
			{ f: () => 1 },
			{ u: undefined },
			{ m: new Map() },
			{ deep: { list: [1, { x: undefined }] } },
			{ title: 'x'.repeat(PROPS_MAX) }
		];
		for (const props of bad)
			expect(() => card_json('src/lib/Card.svelte', props), String(props)).toThrow(
				/image_card_props/
			);
		expect(() => card_json('c', { title: 'x'.repeat(1000) })).not.toThrow();
	});

	test('the id changes with the digest, the size and the props, and with nothing else', () => {
		const json = card_json('c', { title: 'A' });
		const base = card_id({ digest: 'd', width: 1200, height: 630 }, json);
		expect(card_id({ digest: 'd', width: 1200, height: 630 }, json)).toBe(base);
		expect(card_id({ digest: 'e', width: 1200, height: 630 }, json)).not.toBe(base);
		expect(card_id({ digest: 'd', width: 1200, height: 631 }, json)).not.toBe(base);
		expect(
			card_id({ digest: 'd', width: 1200, height: 630 }, card_json('c', { title: 'B' }))
		).not.toBe(base);
	});
});

describe('the descriptor and its recipes', () => {
	test('a card mints its own-size PNG, and its recipes carry the card and its props in a .card/ tail', () => {
		const minted: Recipe[] = [];
		set_minter((r) => {
			minted.push(r);
			return `/signed/${recipe_path(r, recipe_tail(r, []))}`;
		});
		const share = card(spec_of(() => ''))({ title: 'Ships & <harbors>' });
		const json = card_json('c', { title: 'Ships & <harbors>' });
		expect(share).toMatchObject({
			id: card_id({ digest: 'd1', width: 600, height: 315 }, json),
			width: 600,
			height: 315,
			format: 'png',
			from: 'card'
		});
		expect(minted).toHaveLength(1);
		expect(minted[0]).toMatchObject({ width: 600, height: 315, format: 'png', from: 'card' });
		const tail = recipe_tail(minted[0]!, []);
		expect(tail.startsWith('.card/TestCard00000000/')).toBe(true);
		expect(card_of_tail(tail)).toEqual({ card: 'TestCard00000000', props: json });
		const parsed = parse_recipe(share.src.slice('/signed/'.length));
		expect(parsed?.tail).toBe(tail);
		expect(parsed?.id).toBe(share.id);
	});

	test('a tail that is not a card names none', () => {
		for (const tail of [
			'.card/',
			'.card/name',
			'.card/name/',
			'.card/na me/e30',
			'.card/name/e30/x',
			'.remote/aHR0cHM6Ly9leGFtcGxlLmNvbQ',
			'src/lib/a.png'
		])
			expect(card_of_tail(tail), tail).toBeNull();
	});

	test('with no server realm (the browser), a card is image_no_server', () => {
		expect(mint({ id: 'x', src: '', width: 1, height: 1, format: 'png' }, false)).toBeNull();
		expect(() => card(spec_of(() => ''))({ title: 'A' })).toThrow(/image_no_server/);
		expect(() => card_in_browser()).toThrow(/image_no_server/);
	});

	test('its recipe head names the id and the size like any other source', () => {
		const r: Recipe = {
			id: 'cAAAA',
			src: '',
			width: 1200,
			height: 630,
			format: 'png',
			from: 'card',
			card: 'n/e30'
		};
		expect(recipe_head(r)).toBe('cAAAA-1200x630');
		expect(recipe_tail(r, [])).toBe('.card/n/e30');
	});
});

describe('drawing', () => {
	test('character references in text are decoded once, after the markup is read', async () => {
		expect(decode_entities('A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#x27; &amp;lt;')).toBe(
			`A & B <c> "d" 'e' &lt;`
		);
		const tree = await card_tree('<div><span>Ships &amp; &lt;harbors&gt;</span></div>');
		expect(JSON.stringify(tree)).toContain('Ships & <harbors>');
		expect(JSON.stringify(tree)).not.toContain('&amp;');
	});

	test('a class that looks like a Tailwind utility is only a class: the CSS is the component own', async () => {
		const tree = await card_tree(
			'<style>.chip-row.svelte-x { display: flex; color: red; }</style><div class="chip-row svelte-x"><span>a</span></div>'
		);
		expect(JSON.stringify(tree)).not.toContain('"tw"');
		expect(JSON.stringify(tree)).toContain('"color":"red"');
	});

	test('a card draws as a PNG of its own size, with its CSS from its head', async () => {
		const spec = spec_of(
			(p) =>
				`<style>.c.svelte-x { display: flex; width: 600px; height: 315px; background: #102a43; color: #fff; font-size: 40px; }</style><div class="c svelte-x">${String(p.title)}</div>`
		);
		const png = await card_png(spec, { title: 'Hello' }, [bytes_of(MONO)]);
		const meta = await sharp(png).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['png', 600, 315]);
		const { dominant } = await sharp(png).stats();
		expect(dominant).toMatchObject({ r: expect.any(Number) });
		expect(Math.abs(dominant.b - 0x43)).toBeLessThan(24);
	});

	test('CSS satori cannot draw is image_card_css, naming the property and the card', async () => {
		const grid = spec_of(
			() => '<div style="display: grid; width: 10px"><span>a</span><span>b</span></div>'
		);
		await expect(card_png(grid, {}, [bytes_of(MONO)])).rejects.toMatchObject({
			code: 'image_card_css',
			message: expect.stringMatching(/src\/lib\/Card\.svelte[\s\S]*'display'/)
		});
		const block = spec_of(() => '<div><span>a</span><span>b</span></div>');
		await expect(card_png(block, {}, [bytes_of(MONO)])).rejects.toMatchObject({
			code: 'image_card_css'
		});
	});

	test("an image a card's markup names at an address the app does not read it from is refused, coded, and never fetched", async () => {
		const fetched = vi.spyOn(globalThis, 'fetch');
		for (const src of [
			'http://127.0.0.1/secret.png',
			'http://169.254.169.254/latest/meta-data',
			'./relative.png'
		]) {
			const spec = spec_of(
				() =>
					`<div style="display: flex; width: 600px; height: 315px"><img src="${src}" width="10" height="10"></div>`
			);
			await expect(card_png(spec, {}, [bytes_of(MONO)])).rejects.toMatchObject({
				code: 'image_card_source',
				message: expect.stringContaining(src)
			});
		}
		const bg = spec_of(
			() =>
				`<div style="display: flex; width: 600px; height: 315px; background-image: url(http://127.0.0.1/bg.png)">a</div>`
		);
		await expect(card_png(bg, {}, [bytes_of(MONO)])).rejects.toMatchObject({
			code: 'image_card_source'
		});
		expect(fetched).not.toHaveBeenCalled();
		fetched.mockRestore();
	});

	test("an image the card's realm reads (a listed remote host, an asset of the build) is drawn from bytes ogygia hands satori", async () => {
		const red = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } })
			.png()
			.toBuffer();
		const asked: string[] = [];
		const spec = spec_of(
			() =>
				`<div style="display: flex; width: 600px; height: 315px"><img src="https://cms.example.com/a.png" style="width: 600px; height: 315px"></div>`
		);
		const png = await card_png(spec, {}, [bytes_of(MONO)], (src) => {
			asked.push(src);
			return Promise.resolve(new Uint8Array(red));
		});
		expect(asked).toEqual(['https://cms.example.com/a.png']);
		const { channels } = await sharp(png).stats();
		expect(channels.slice(0, 3).map((c) => Math.round(c.mean))).toEqual([255, 0, 0]);
	});

	test('a failure that is no CSS refusal (a font that does not load) keeps its own error, not image_card_css', async () => {
		const spec = spec_of(() => '<div style="display: flex">a</div>');
		const error = await card_png(spec, {}, [new ArrayBuffer(8)]).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(Error);
		expect((error as { code?: string }).code).not.toBe('image_card_css');
	});
});

describe('fonts', () => {
	test('a font file names its family, weight and style', () => {
		expect(font_face(fs.readFileSync(MONO))).toEqual({
			name: 'JetBrains Mono',
			weight: 500,
			style: 'normal'
		});
		expect(font_face(fs.readFileSync(MONO.replace('500-normal', '400-italic')))).toEqual({
			name: 'JetBrains Mono',
			weight: 400,
			style: 'italic'
		});
	});

	test('a WOFF2 file, or one that is no font, does not read', () => {
		expect(() => font_face(fs.readFileSync(MONO_WOFF2))).toThrow(FontUnreadable);
		expect(() => font_face(Buffer.from('not a font at all'))).toThrow(FontUnreadable);
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-card-font-'));
		const cut = path.join(dir, 'cut.woff');
		fs.writeFileSync(cut, fs.readFileSync(MONO).subarray(0, 60));
		expect(() => font_face(fs.readFileSync(cut))).toThrow(FontUnreadable);
	});
});

describe('components compiled for a card', () => {
	test('each asks for its CSS in the render, whatever options it had', () => {
		expect(with_injected_css('<div></div>')).toBe('<svelte:options css="injected" />\n<div></div>');
		expect(with_injected_css('<svelte:options runes />\n<p></p>')).toBe(
			'<svelte:options css="injected" runes />\n<p></p>'
		);
		expect(with_injected_css(`<svelte:options css='external'></svelte:options>`)).toBe(
			'<svelte:options css="injected"></svelte:options>'
		);
		expect(
			with_injected_css(`<script>const a = '<svelte:options>';</script>\n<svelte:options runes />`)
		).toBe(
			`<script>const a = '<svelte:options>';</script>\n<svelte:options css="injected" runes />`
		);
	});

	test('only a .svelte file under the og-card query is one', () => {
		expect(is_card_component('/a/Card.svelte?og-card')).toBe(true);
		expect(is_card_component('/a/Card.svelte?x=1&og-card')).toBe(true);
		expect(is_card_component('/a/Card.svelte')).toBe(false);
		expect(is_card_component('/a/Card.svelte?og-cards')).toBe(false);
		expect(is_card_component('/a/card.ts?og-card')).toBe(false);
	});
});

describe('the share image dev rule', () => {
	test('names an og:image or twitter:image that is AVIF or WebP, and no PNG, JPEG or other meta', () => {
		const html = dedent`
			<meta property="og:image" content="https://x.example/a.webp">
			<meta name='twitter:image' content='/b.avif?v=1'>
			<meta property="og:image" content="https://x.example/c.png">
			<meta property="og:image:secure_url" content="/d.jpg">
			<meta property="og:title" content="e.webp">
			<script>const s = '<meta property="og:image" content="/g.webp">';</script>
			<meta content="/f.webp" property="og:image" />
		`;
		expect(unshown_share_images(html)).toEqual([
			'https://x.example/a.webp',
			'/b.avif?v=1',
			'/f.webp'
		]);
	});
});
