// What sharp is asked to do for a file and for a placeholder is part of each file's name and of each
// plan's key (ENCODER_VERSION, PLAN_VERSION). A change to those asks with no bump would ship new
// bytes under the old immutable names, and the build store would keep the old files.
import crypto from 'node:crypto';
import { expect, test, vi } from 'vitest';

const calls = vi.hoisted(() => [] as unknown[]);

vi.mock('sharp', () => {
	const make = (_bytes: unknown, options: unknown) => {
		calls.push(['sharp', options]);
		const img: object = new Proxy(
			{},
			{
				get: (_, key) => {
					if (typeof key !== 'string' || key === 'then') return undefined;
					if (key === 'toBuffer')
						return (o?: { resolveWithObject?: boolean }) =>
							Promise.resolve(
								o?.resolveWithObject ? { data: Buffer.alloc(4, 255), info: {} } : Buffer.alloc(0)
							);
					if (key === 'metadata')
						return () => Promise.resolve({ width: 640, height: 480, format: 'jpeg' });
					return (...args: unknown[]) => {
						calls.push([key, args]);
						return img;
					};
				}
			}
		);
		return img;
	};
	return {
		default: Object.assign(make, {
			versions: { vips: 'test' },
			strategy: { attention: 16, entropy: 17 }
		})
	};
});

const { encode_recipe, placeholder_of } = await import('../src/pixels.ts');
const { ENCODER_VERSION } = await import('../src/source-id.ts');
const { PLAN_VERSION } = await import('../src/vite/plan.ts');

const print = (log: unknown[]) =>
	crypto.createHash('sha256').update(JSON.stringify(log)).digest('base64url');

const ENCODE_SEEN: Readonly<Record<number, string>> = {
	4: 'EsYiJpvY9B4r6Yr2cZpOjmhHs0qPQILHLvMovlTabCI',
	5: 'zQ1Tgif-2bnT_7_NVNDL_aRXPQf4Gj8OKncJpaa_PIA'
};
const PLAN_SEEN: Readonly<Record<number, string>> = {
	3: 'KLzVqaMUXxzeRZHs07FnTgJrfhQW0jT5lDgAhl_eHnA'
};

test('a change to what sharp is asked for a file bumps ENCODER_VERSION, so no built name keeps old bytes', async () => {
	calls.length = 0;
	const bytes = new Uint8Array(1);
	for (const format of ['avif', 'webp', 'jpeg', 'png'] as const) {
		await encode_recipe(bytes, { width: 320, height: 240, format });
		await encode_recipe(bytes, { width: 320, height: 240, format, quality: 55, position: 'top' });
	}
	await encode_recipe(bytes, {
		width: 100,
		height: 100,
		format: 'webp',
		position: 'attention',
		ops: {
			rotate: 90,
			flip: true,
			flop: true,
			grayscale: true,
			blur: 2,
			sharpen: true,
			normalize: true,
			negate: true,
			gamma: 2.2,
			tint: '#123456',
			modulate: { brightness: 1.1 }
		}
	});
	expect(ENCODE_SEEN[ENCODER_VERSION]).toBe(print(calls));
});

test('a change to what sharp is asked for a placeholder bumps PLAN_VERSION, so no kept plan keeps the old one', async () => {
	calls.length = 0;
	await placeholder_of(new Uint8Array(1), {}, { width: 640, height: 480 });
	await placeholder_of(new Uint8Array(1), { grayscale: true }, { width: 8, height: 30 });
	expect(PLAN_SEEN[PLAN_VERSION]).toBe(print(calls));
});

test("sharp({ effort: { avif } }) is what sharp is asked for an AVIF file, by the endpoint's maker and the build alike; the default is 2", async () => {
	const { sharp } = await import('../src/vite/encoder.ts');
	const { sharp_maker } = await import('../src/makers/sharp-at.ts');
	const avif = () =>
		calls
			.filter((c) => (c as [string])[0] === 'avif')
			.map((c) => (c as [string, [{ effort: number }]])[1][0].effort);
	calls.length = 0;
	await encode_recipe(new Uint8Array(1), { width: 32, height: 32, format: 'avif' });
	await encode_recipe(new Uint8Array(1), { width: 32, height: 32, format: 'avif' }, 7);
	await sharp_maker(sharp({ effort: { avif: 5 } }).effort!.avif).make(
		new Uint8Array(1),
		{ id: 'x', width: 32, height: 32, format: 'avif' } as never,
		undefined
	);
	expect(avif()).toEqual([2, 7, 5]);
	expect(sharp().effort).toEqual({ avif: 2 });
});

test('an AVIF effort that is no whole number from 0 to 9, or an unknown key, fails the build with a code', async () => {
	const { sharp } = await import('../src/vite/encoder.ts');
	for (const avif of [-1, 10, 2.5, '4', null])
		expect(() => sharp({ effort: { avif: avif as number } }), String(avif)).toThrow(
			/image_option_invalid[\s\S]*effort\.avif|effort\.avif[\s\S]*image_option_invalid/
		);
	expect(() => sharp({ effort: { webp: 4 } as never })).toThrow(/image_option_unknown/);
	expect(() => sharp({ speed: 1 } as never)).toThrow(/image_option_unknown/);
	expect(sharp({ effort: { avif: 0 } }).effort).toEqual({ avif: 0 });
	expect(sharp({ effort: { avif: 9 } }).effort).toEqual({ avif: 9 });
});
