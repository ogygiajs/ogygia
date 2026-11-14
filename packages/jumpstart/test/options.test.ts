import { describe, expect, it } from 'vitest';
import { Options, type JumpstartOptions } from '../src/options.ts';
import { jumpstart } from '../src/index.ts';

describe('options', () => {
	it('external defaults to none, and a name listed twice is kept once', () => {
		expect(new Options().external).toEqual([]);
		expect(new Options({ external: ['sharp', 'pg', 'sharp'] }).external).toEqual(['sharp', 'pg']);
	});

	it('a misspelled option fails the build instead of being ignored', () => {
		expect(() => new Options({ externals: ['sharp'] } as JumpstartOptions)).toThrow(
			/jumpstart_option_unknown|no option named `externals`/
		);
	});

	it('external that is not a list of names fails the build', () => {
		for (const external of ['sharp', [''], [42]])
			expect(() => new Options({ external } as unknown as JumpstartOptions)).toThrow(
				/external` takes a list of package names/
			);
	});

	it('jumpstart() is an ogygia plugin and a Vite plugin that applies to builds only', () => {
		const [own, vite] = jumpstart();
		expect(own.name).toBe('@ogygia/jumpstart');
		expect(vite.name).toBe('@ogygia/jumpstart:server');
		expect(vite.apply).toBe('build');
	});
});
