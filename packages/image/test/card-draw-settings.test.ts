// What a card's draw asks of sharp (the fitter), satori and resvg is part of every card's name
// (CARD_DRAW_VERSION in card_id). A change to those asks with no bump would ship new PNGs under the old
// immutable names, and every warm build store and live store would keep the old ones.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';

const calls = vi.hoisted(() => [] as unknown[]);
const meta = vi.hoisted(() => ({ next: {} as Record<string, unknown> }));

vi.mock('sharp', () => {
	const make = (_bytes: unknown, options: unknown) => {
		calls.push(['sharp', options]);
		const img: object = new Proxy(
			{},
			{
				get: (_, key) => {
					if (typeof key !== 'string' || key === 'then') return undefined;
					if (key === 'toBuffer') return () => Promise.resolve(Buffer.from('made'));
					if (key === 'metadata') return () => Promise.resolve(meta.next);
					return (...args: unknown[]) => {
						calls.push([key, args]);
						return img;
					};
				}
			}
		);
		return img;
	};
	return { default: Object.assign(make, { versions: { vips: 'test' } }) };
});

vi.mock('satori', () => ({
	default: (tree: unknown, options: { fonts: { data: ArrayBuffer }[] }) => {
		calls.push([
			'satori',
			tree,
			{ ...options, fonts: options.fonts.map((f) => ({ ...f, data: f.data.byteLength })) }
		]);
		return Promise.resolve('<svg/>');
	}
}));

vi.mock('satori-html', () => ({
	html: (markup: string) => {
		calls.push(['satori-html', markup]);
		return {
			type: 'div',
			props: {
				style: { display: 'flex', width: '600px', height: '315px' },
				children: [
					{ type: 'p', props: { style: { color: 'red' }, children: 'A &amp; B' } },
					{ type: 'img', props: { src: '/a.png', style: { width: '10px' } } },
					{ type: 'a', props: { href: '/about', children: 'About' } },
					{
						type: 'div',
						props: { style: { display: 'flex', backgroundImage: "url('/b.png')" }, tw: 'x' }
					}
				]
			}
		};
	}
}));

vi.mock('@resvg/resvg-js', () => ({
	Resvg: class {
		constructor(svg: string, options: unknown) {
			calls.push(['resvg', svg, options]);
		}
		render() {
			return { asPng: () => new Uint8Array([1]) };
		}
	}
}));

const { fit_to_card } = await import('../src/cards/fit.ts');
const { card_png, ENGINE_PACKAGES } = await import('../src/cards/engine.ts');
const { card_id } = await import('../src/card.ts');
const { CARD_DRAW_VERSION } = await import('../src/source-id.ts');
const { engine_versions } = await import('../src/vite/card.ts');

const PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
	'base64'
);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

function bytes_of(value: unknown): unknown {
	if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
		const b = Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
		return `bytes ${b.byteLength} ${crypto.createHash('sha256').update(b).digest('base64url')}`;
	}
	return value;
}

const print = (log: unknown[]) =>
	crypto
		.createHash('sha256')
		.update(JSON.stringify(log, (_k, v: unknown) => bytes_of(v)))
		.digest('base64url');

const DRAW_SEEN: Readonly<Record<number, string>> = {
	1: 'mG3N-aJqVKoA3BR1_i5-ncsX_84dTKq131wypstNCxU',
	2: 'BWb1C0JsMINlHb4pWdwcR_AyZ8B26CqJE3LI6LI6DQs',
	3: 'BWb1C0JsMINlHb4pWdwcR_AyZ8B26CqJE3LI6LI6DQs'
};

const FIT_CASES: readonly Record<string, unknown>[] = [
	{ format: 'jpeg', width: 300, height: 300, space: 'srgb', depth: 'uchar', channels: 3 },
	{ format: 'jpeg', width: 300, height: 300, space: 'cmyk', depth: 'uchar', channels: 4 },
	{ format: 'jpeg', width: 300, height: 300, space: 'srgb', depth: 'uchar', hasProfile: true },
	{ format: 'jpeg', width: 300, height: 300, space: 'srgb', depth: 'uchar', orientation: 6 },
	{ format: 'jpeg', width: 4000, height: 3000, space: 'srgb', depth: 'uchar', channels: 3 },
	{ format: 'png', width: 300, height: 300, space: 'rgb16', depth: 'ushort', channels: 3 },
	{ format: 'png', width: 300, height: 300, space: 'b-w', depth: 'uchar', channels: 1 },
	{ format: 'png', width: 4000, height: 3000, space: 'srgb', depth: 'uchar', hasAlpha: true }
];

test('a change to what a card asks of sharp, satori or resvg bumps CARD_DRAW_VERSION, so no card name keeps an old PNG', async () => {
	calls.length = 0;
	for (const m of FIT_CASES) {
		meta.next = m;
		const out = await fit_to_card(m.format === 'png' ? new Uint8Array(PNG_1X1) : JPEG, 600, 315);
		calls.push(['fitted', m, out]);
	}
	await card_png(
		{
			card: 'TestCard00000000',
			file: 'src/lib/Card.svelte',
			digest: 'd1',
			width: 600,
			height: 315,
			fonts: [{ name: 'Mono', weight: 500, style: 'normal', src: '/font.woff' }],
			html: () => Promise.resolve('<div> <p>A &amp; B</p>  </div>')
		},
		{},
		[new ArrayBuffer(8)],
		() => Promise.resolve(new Uint8Array(PNG_1X1)),
		(bytes) => Promise.resolve({ bytes, type: 'image/png' })
	);
	expect(DRAW_SEEN[CARD_DRAW_VERSION], print(calls)).toBe(print(calls));
});

test("a card's name holds the draw version: another version names the same card and props anew", async () => {
	const spec = { digest: 'd1', width: 600, height: 315 };
	const now = card_id(spec, '{}');
	vi.resetModules();
	vi.doMock('../src/source-id.ts', async (original) => ({
		...(await original<object>()),
		CARD_DRAW_VERSION: CARD_DRAW_VERSION + 1
	}));
	const next = await import('../src/card.ts');
	vi.doUnmock('../src/source-id.ts');
	expect(next.card_id(spec, '{}')).not.toBe(now);
});

test("a card's digest holds the versions of satori, satori-html and resvg the app has", () => {
	const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
	const { line } = engine_versions(root);
	for (const name of ENGINE_PACKAGES) expect(line).toMatch(new RegExp(`${name}@\\d`));
});
