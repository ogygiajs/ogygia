// Share cards at build: the macro call checked and turned into an import of the card's module, the
// module each runtime gets, the digest (a change to a child component, its CSS or a font names new
// files; an unrelated module does not), the chunk placeholders, and the engine check's table.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { check, dead_fields } from '@ogygia/machine/testing';
import { dedent } from '@ogygia/core/contract';
import {
	build_card_images,
	CARD_ENGINE_CHECK,
	card_digest,
	Cards,
	CARD_PREFIX
} from '../src/vite/card.ts';
import { image_call_edits } from '../src/vite/macro.ts';

const MONO = createRequire(import.meta.url).resolve(
	'@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'
);

let dir: string;
beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-card-build-'));
	fs.writeFileSync(path.join(dir, 'Card.svelte'), '<div>{title}</div>');
	fs.writeFileSync(path.join(dir, 'notes.txt'), '');
	fs.copyFileSync(MONO, path.join(dir, 'mono.woff'));
	fs.copyFileSync(MONO.replace(/\.woff$/, '.woff2'), path.join(dir, 'mono.woff2'));
});

const mod = (): string => path.join(dir, 'share.ts');

function call(options: string, component = './Card.svelte'): string {
	return `export const Share = import.meta.og.image.card(${JSON.stringify(component)}, ${options});\n`;
}

function rewrite(src: string, cards: Cards, id = mod()): string {
	let out = '';
	let last = 0;
	for (const e of image_call_edits(src, id, undefined, () => {}, [], null, cards, dir)) {
		out += src.slice(last, e.start) + e.text;
		last = e.end;
	}
	return out + src.slice(last);
}

const GOOD = `{ width: 1200, height: 630, fonts: ['./mono.woff'] }`;

describe('the macro', () => {
	test('a card call becomes an import of its module, named by its arguments, which records the card', () => {
		const cards = new Cards();
		const out = rewrite(call(GOOD), cards);
		const name = /virtual:ogygia-image\/card\/([\w-]{16})/.exec(out)![1]!;
		expect(out).toContain(`import __og_card_0 from "${CARD_PREFIX}${name}";`);
		expect(out).toContain('export const Share = __og_card_0;');
		expect(cards.get(name)).toMatchObject({
			rel: 'Card.svelte',
			width: 1200,
			height: 630,
			fonts: [{ face: { name: 'JetBrains Mono', weight: 500, style: 'normal' } }]
		});
		const again = rewrite(call(GOOD), new Cards());
		expect(again).toContain(name);
		expect(
			rewrite(call(`{ width: 1200, height: 600, fonts: ['./mono.woff'] }`), cards)
		).not.toContain(name);
	});

	test('a package font resolves from the file that names it', () => {
		const cards = new Cards();
		const here = path.join(path.dirname(new URL(import.meta.url).pathname), 'share.ts');
		const out = rewrite(
			call(
				`{ width: 10, height: 10, fonts: ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'] }`,
				path.relative(path.dirname(here), path.join(dir, 'Card.svelte'))
			),
			cards,
			here
		);
		const name = /card\/([\w-]{16})/.exec(out)![1]!;
		expect(cards.get(name)?.fonts[0]?.file).toBe(MONO);
	});

	test('what a card cannot be drawn from fails the build, coded', () => {
		const bad: [string, string, RegExp][] = [
			[`{ width: 1200, height: 630 }`, './Card.svelte', /image_card_font/],
			[`{ width: 1200, height: 630, fonts: [] }`, './Card.svelte', /image_card_font/],
			[`{ width: 1200, height: 630, fonts: ['./mono.woff2'] }`, './Card.svelte', /image_card_font/],
			[`{ width: 1200, height: 630, fonts: ['./nope.woff'] }`, './Card.svelte', /image_card_font/],
			[`{ width: 1200, height: 630, fonts: ['./notes.txt'] }`, './Card.svelte', /image_card_font/],
			[
				`{ width: 0, height: 630, fonts: ['./mono.woff'] }`,
				'./Card.svelte',
				/image_option_invalid/
			],
			[
				`{ width: 1.5, height: 630, fonts: ['./mono.woff'] }`,
				'./Card.svelte',
				/image_option_invalid/
			],
			[
				`{ width: 1, height: 1, fonts: ['./mono.woff'], depth: 2 }`,
				'./Card.svelte',
				/image_option_unknown/
			],
			[GOOD, './notes.txt', /image_option_invalid/],
			[GOOD, './Missing.svelte', /image_not_found/]
		];
		for (const [options, component, code] of bad) {
			let thrown: unknown;
			try {
				rewrite(call(options, component), new Cards());
			} catch (e) {
				thrown = e;
			}
			expect((thrown as { code?: string } | undefined)?.code, `${component} ${options}`).toMatch(
				code
			);
		}
		expect(() =>
			rewrite(`export const S = import.meta.og.image.card('./Card.svelte');\n`, new Cards())
		).toThrow();
	});

	test("a card call in a component's markup is left as is, for ogygia's macro_in_markup", () => {
		const src = dedent`
			<script>let x = 1;</script>
			<p>{import.meta.og.image.card('./Card.svelte', ${GOOD})}</p>
		`;
		expect(rewrite(src, new Cards(), path.join(dir, 'Page.svelte'))).toBe(src);
	});
});

describe("the card's module", () => {
	function named(): { cards: Cards; name: string } {
		const cards = new Cards();
		const out = rewrite(call(GOOD), cards);
		return { cards, name: /card\/([\w-]{16})/.exec(out)![1]! };
	}

	test('the browser gets the refusal; the server the spec, the component under the og-card query, and the engine where it runs', () => {
		const { cards, name } = named();
		expect(cards.module(name, 'client')).toContain('card_in_browser');
		const server = cards.module(name, 'server')!;
		expect(server).toContain('Card.svelte?og-card');
		expect(server).toContain(`"digest":"__ogygia_image_card_digest_${name}__"`);
		expect(server).toContain('"name":"JetBrains Mono","weight":500,"style":"normal"');
		expect(server).toContain('card_png');
		const edge = cards.module(name, 'edge')!;
		expect(edge).not.toContain('card_png');
		expect(edge).toContain('export const spec');
		expect(cards.module('nope', 'server')).toBeNull();
	});

	test('in dev, each load of a card names it anew', () => {
		const { cards, name } = named();
		const digest = (code: string): string => /"digest":"([^"]+)"/.exec(code)![1]!;
		const a = digest(cards.module(name, 'dev')!);
		const b = digest(cards.module(name, 'dev')!);
		expect(a).not.toBe(b);
	});

	test("a rendered chunk gets each card's digest and the list of the cards' own chunks", () => {
		const { cards, name } = named();
		cards.emitted(name, 'ref1');
		const code = `const s = {"digest":"__ogygia_image_card_digest_${name}__"};\nfunction card_module(n) { return find_card("__ogygia_image_cards__", n); }`;
		const out = cards.render_chunk(
			code,
			() => 'chunks/settle.js',
			dir,
			() => 'chunks/card-abc.js',
			() => ({ importedIds: [], dynamicallyImportedIds: [] })
		)!;
		expect(out).not.toContain('__ogygia_image_card');
		expect(out).toMatch(/"digest":"[\w-]{43}"/);
		expect(out).toContain(`find_card({"${name}": () => import("./card-abc.js")}, n)`);
		expect(
			cards.render_chunk(
				'const x = 1;',
				() => 'a.js',
				dir,
				String,
				() => null
			)
		).toBeNull();
	});
});

describe('the digest', () => {
	test('a child component, its CSS or a font changes it; a module the card does not import does not', () => {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), 'og-card-digest-'));
		const file = (name: string, text: string | Buffer): string => {
			fs.writeFileSync(path.join(d, name), text);
			return path.join(d, name);
		};
		const card = file('Card.svelte', '<script>import Chip from "./Chip.svelte";</script><Chip />');
		const chip = file('Chip.svelte', '<span class="c">x</span><style>.c { color: red; }</style>');
		const css = file('card.css', '.card { display: flex; }');
		const font = file('mono.woff', fs.readFileSync(MONO));
		const other = file('Other.svelte', '<p>other</p>');
		const start = '\0virtual:ogygia-image/card/abc';
		const graph: Record<string, string[]> = {
			[start]: [`${card}?og-card`, font, '/x/node_modules/svelte/src/index-server.js'],
			[`${card}?og-card`]: [`${chip}?og-card`, css],
			[`${chip}?og-card`]: [],
			[other]: []
		};
		const def = {
			name: 'abc',
			rel: 'Card.svelte',
			width: 1200,
			height: 630,
			fonts: [{ face: { name: 'JetBrains Mono', weight: 500, style: 'normal' as const } }]
		};
		const digest = (): string =>
			card_digest(
				start,
				def,
				'satori@1 svelte@5',
				d,
				(id) => (id in graph ? { importedIds: graph[id]!, dynamicallyImportedIds: [] } : null),
				(f) => (fs.existsSync(f) ? fs.readFileSync(f) : null)
			);
		const base = digest();
		expect(digest()).toBe(base);
		fs.writeFileSync(other, '<p>changed</p>');
		expect(digest()).toBe(base);
		fs.writeFileSync(chip, '<span class="c">x</span><style>.c { color: blue; }</style>');
		const after_chip = digest();
		expect(after_chip).not.toBe(base);
		fs.writeFileSync(css, '.card { display: none; }');
		const after_css = digest();
		expect(after_css).not.toBe(after_chip);
		const bytes = fs.readFileSync(font);
		bytes[bytes.length - 1] ^= 1;
		fs.writeFileSync(font, bytes);
		expect(digest()).not.toBe(after_css);
		const before_versions = digest();
		expect(
			card_digest(
				start,
				def,
				'satori@2 svelte@5',
				d,
				(id) => (id in graph ? { importedIds: graph[id]!, dynamicallyImportedIds: [] } : null),
				(f) => (fs.existsSync(f) ? fs.readFileSync(f) : null)
			)
		).not.toBe(before_versions);
	});

	test("a package's font or module whose bytes change at the same path (npm or yarn: no version in it) changes it; a file's built code does not (a cold and a warm build differ there)", () => {
		const d = fs.mkdtempSync(path.join(os.tmpdir(), 'og-card-digest-npm-'));
		const pkg = path.join(d, 'node_modules', '@fontsource', 'inter', 'files');
		fs.mkdirSync(pkg, { recursive: true });
		const font = path.join(pkg, 'inter-latin-400-normal.woff');
		fs.writeFileSync(font, fs.readFileSync(MONO));
		const card = path.join(d, 'Card.svelte');
		fs.writeFileSync(card, '<div class="card">x</div>');
		const start = '\0virtual:ogygia-image/card/npm';
		const code = { card: 'css-v1' };
		const graph: Record<string, string[]> = { [start]: [`${card}?og-card`, font] };
		const def = {
			name: 'npm',
			rel: 'Card.svelte',
			width: 1200,
			height: 630,
			fonts: [{ face: { name: 'Inter', weight: 400, style: 'normal' as const } }]
		};
		const digest = (): string =>
			card_digest(
				start,
				def,
				'satori@1 svelte@5',
				d,
				(id) =>
					id in graph
						? { importedIds: graph[id]!, dynamicallyImportedIds: [] }
						: id === `${card}?og-card`
							? { importedIds: [], dynamicallyImportedIds: [], code: code.card }
							: null,
				(f) => (fs.existsSync(f) ? fs.readFileSync(f) : null)
			);
		const base = digest();
		const bytes = fs.readFileSync(font);
		bytes[bytes.length - 1] ^= 1;
		fs.writeFileSync(font, bytes);
		const after_font = digest();
		expect(after_font).not.toBe(base);
		code.card = 'css-v2';
		expect(digest()).toBe(after_font);
	});
});

test('every row of the card engine table: nothing draws without the engine installed and listed, no server without it in dependencies, an edge build warns', () => {
	check(CARD_ENGINE_CHECK, {
		'a client build checks nothing': (r) =>
			!('plan' in r) || r.input.runtime !== 'client' || r.plan === 'ok',
		'no engine installed fails': (r) =>
			!('plan' in r) || r.input.runtime === 'client' || r.input.installed || r.plan === 'missing',
		'a server goes on only with the engine in dependencies': (r) =>
			!('plan' in r) ||
			r.input.runtime !== 'server' ||
			r.plan !== 'ok' ||
			r.input.listed === 'dependencies',
		'an edge build with the engine warns': (r) =>
			!('plan' in r) ||
			r.input.runtime !== 'edge' ||
			!r.input.installed ||
			r.input.listed === 'none' ||
			r.plan === 'edge'
	});
	expect(dead_fields(CARD_ENGINE_CHECK)).toEqual([]);
});

test("the build reads a card's image where the live endpoint does, the server's assets: a client-only file or a static/ file is refused", async () => {
	const output = fs.mkdtempSync(path.join(os.tmpdir(), 'og-card-output-'));
	const at = (side: string, file: string) => {
		fs.mkdirSync(path.dirname(path.join(output, side, file)), { recursive: true });
		fs.writeFileSync(path.join(output, side, file), 'bytes');
	};
	at('server', '_app/immutable/assets/hero.Ab12.jpg');
	at('client', '_app/immutable/assets/client-only.Cd34.jpg');
	at('client', 'logo.png');
	const read = build_card_images(output, ['', ''], null);
	expect(Buffer.from(await read('/_app/immutable/assets/hero.Ab12.jpg')).toString()).toBe('bytes');
	for (const src of ['/_app/immutable/assets/client-only.Cd34.jpg', '/logo.png'])
		await expect(read(src), src).rejects.toThrow(/no file/);
});
