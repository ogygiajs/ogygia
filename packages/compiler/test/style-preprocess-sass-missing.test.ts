// An app with SCSS styles but neither `sass-embedded` nor `sass` installed: the style is left as
// written and the build says so, once for the process.
import { expect, it, vi } from 'vitest';

vi.mock('node:module', async (orig) => {
	const real = await orig<typeof import('node:module')>();
	const createRequire = (from: string) => {
		const req = real.createRequire(from);
		return Object.assign((id: string) => {
			if (id === 'sass' || id === 'sass-embedded') throw new Error(`Cannot find module '${id}'`);
			return req(id);
		}, req);
	};
	return { ...real, createRequire, default: { ...real, createRequire } };
});
const { preprocess_component_for_css } = await import('../src/vite/style-preprocess.ts');

it('no sass compiler from the app root: the style is left as is, and sass_missing is said once', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const src = '<p class="a">x</p><style lang="scss">$c: red; .a { color: $c; }</style>';
	expect(await preprocess_component_for_css(src, '/app/src/A.svelte', '/app')).toBe(src);
	expect(await preprocess_component_for_css(src, '/app/src/B.svelte', '/app')).toBe(src);
	const said = warn.mock.calls.filter((c) => String(c[0]).includes('sass_missing'));
	expect(said).toHaveLength(1);
	warn.mockRestore();
});
