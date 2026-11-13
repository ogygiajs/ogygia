// A component's SCSS that does not compile, or TypeScript the stripper refuses: that block is left
// as written, the build says which file and why, and the rest of the component is still read.
import { expect, it, vi } from 'vitest';

vi.mock('node:module', async (orig) => {
	const real = await orig<typeof import('node:module')>();
	const createRequire = (from: string) => {
		const req = real.createRequire(from);
		return Object.assign((id: string) => {
			if (id === 'sass-embedded')
				return {
					compileString: () => {
						throw new Error('expected "{"');
					}
				};
			return req(id);
		}, req);
	};
	return { ...real, createRequire, default: { ...real, createRequire } };
});
vi.mock('vite', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	transformWithOxc: async () => {
		throw new Error('Unexpected token');
	}
}));
const { preprocess_component_for_css } = await import('../src/vite/style-preprocess.ts');

it('SCSS that does not compile is left as written, and scss_compile_failed names the file', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const src = '<p class="a">x</p><style lang="scss">.a { color: red</style>';
		expect(await preprocess_component_for_css(src, '/app/src/A.svelte', '/app')).toBe(src);
		const said = warn.mock.calls
			.map((c) => String(c[0]))
			.filter((s) => s.includes('scss_compile_failed'));
		expect(said).toHaveLength(1);
		expect(said[0]).toContain('src/A.svelte');
	} finally {
		warn.mockRestore();
	}
});

it('TypeScript the stripper refuses is left as written, and ts_strip_failed names the file', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const src = '<script lang="ts">let a: = 1;</script><p>x</p>';
		expect(await preprocess_component_for_css(src, '/app/src/B.svelte', '/app')).toBe(src);
		const said = warn.mock.calls
			.map((c) => String(c[0]))
			.filter((s) => s.includes('ts_strip_failed'));
		expect(said).toHaveLength(1);
		expect(said[0]).toContain('src/B.svelte');
	} finally {
		warn.mockRestore();
	}
});
