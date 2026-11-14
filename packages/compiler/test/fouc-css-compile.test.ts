// A component's scoped CSS for the fouc module and the router: compiled from the whole source first
// (a template that binds or reads a script name only compiles with its script, and a top-level `await`
// is allowed), then with the script stripped (a script Svelte cannot read), then the raw style bodies,
// marked unscoped. A failure with a preprocessed script is reported.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { dedent } from '@ogygia/core/contract';

const calls = vi.hoisted(() => ({ compile: 0 }));
vi.mock('svelte/compiler', async (orig) => {
	const real = await orig<typeof import('svelte/compiler')>();
	return {
		...real,
		compile: (...a: Parameters<typeof real.compile>) => {
			calls.compile++;
			return real.compile(...a);
		}
	};
});
const { compileFoucScopedCss } = await import('../src/fouc-css.ts');

const ABS = '/app/src/lib/C.svelte';
beforeEach(() => {
	calls.compile = 0;
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('compileFoucScopedCss', () => {
	test('a template that binds a script name compiles once, whole', () => {
		const css = compileFoucScopedCss(
			ABS,
			`<script>let v = $state('');</script><input class="a" bind:value={v} /><style>.a { color: red }</style>`
		);
		expect(css).toMatch(/\.a\.svelte-\w+/);
		expect(calls.compile).toBe(1);
	});

	test('a script with a top-level await compiles once, whole', () => {
		const css = compileFoucScopedCss(
			ABS,
			`<script>const d = await Promise.resolve(1);</script><p class="a">{d}</p><style>.a { color: red }</style>`
		);
		expect(css).toMatch(/\.a\.svelte-\w+/);
		expect(calls.compile).toBe(1);
	});

	test('a script Svelte cannot read: the markup is scoped without it', () => {
		const css = compileFoucScopedCss(
			ABS,
			`<script>let x = ;</script><p class="a">x</p><style>.a { color: red }</style>`
		);
		expect(css).toMatch(/^\.a\.svelte-\w+/);
	});

	test('a preprocessed component that still fails to compile is reported; an unprocessed one is not', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const broken = dedent`
			<script>let x = ;</script>
			<p class="a">{#if}</p>
			<style>.a { color: red }</style>
		`;
		compileFoucScopedCss(ABS, broken);
		expect(warn).not.toHaveBeenCalled();
		compileFoucScopedCss(ABS, broken, { keepScript: true });
		expect(String(warn.mock.calls[0]?.[0])).toContain('scoped_css_failed');
	});
});
