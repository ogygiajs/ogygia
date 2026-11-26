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
	4: 'EsYiJpvY9B4r6Yr2cZpOjmhHs0qPQILHLvMovlTabCI'
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
