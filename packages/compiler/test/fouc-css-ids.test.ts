// FOUC virtual ids carry a root-relative path, and the dev `load()` hook joins it to the root and
// reads the file. So an id must round-trip exactly, and a crafted one (absolute, a drive, a `..`
// step, encoded or not) must decode to null, never to a path outside the project. Also: the
// unscoped fallback unwraps `:global(…)`, which the browser would otherwise drop with its rule.
import { describe, expect, it } from 'vitest';
import {
	FOUC_CSS_PREFIX,
	FOUC_SCOPED_PREFIX,
	compileFoucScopedCss,
	foucCssVirtualId,
	foucRelFromId,
	foucScopedVirtualId,
	isFoucCssId,
	isFoucScopedId
} from '../src/fouc-css.ts';

describe('fouc ids round-trip', () => {
	it.each(['src/lib/A.svelte', 'src/routes/(app)/[slug]/+page.svelte', 'src/lib/a b%c.svelte'])(
		'%s',
		(rel) => {
			for (const id of [foucCssVirtualId(rel), foucScopedVirtualId(rel)]) {
				expect(foucRelFromId(id)).toBe(rel);
				expect(foucRelFromId(`\0${id}`)).toBe(rel);
			}
			expect(isFoucCssId(foucCssVirtualId(rel))).toBe(true);
			expect(isFoucScopedId(foucScopedVirtualId(rel))).toBe(true);
			expect(isFoucCssId(foucScopedVirtualId(rel))).toBe(false);
			expect(isFoucScopedId(foucCssVirtualId(rel))).toBe(false);
		}
	);

	it('another module of the same extension is not a fouc id', () => {
		expect(isFoucCssId('/app/src/lib/a.js')).toBe(false);
		expect(isFoucScopedId('/app/src/lib/a.css')).toBe(false);
		expect(isFoucCssId(`${FOUC_CSS_PREFIX}a.svelte.css`)).toBe(false);
		expect(isFoucScopedId(`${FOUC_SCOPED_PREFIX}a.svelte.js`)).toBe(false);
	});

	it('a backslash path is written with slashes', () => {
		expect(foucRelFromId(foucScopedVirtualId('src\\lib\\A.svelte'))).toBe('src/lib/A.svelte');
	});

	it.each([
		[`${FOUC_CSS_PREFIX}src%2Flib%2FA.svelte.css`, null],
		[`${FOUC_SCOPED_PREFIX}src%2Flib%2FA.svelte.js`, null],
		['ogygia:region/other/src%2Flib%2FA.svelte.js', null],
		[`${FOUC_SCOPED_PREFIX}bad%E0%A4%A.css`, 'bad%E0%A4%A']
	])('%s decodes to %s', (id, want) => {
		expect(foucRelFromId(id)).toBe(want);
	});
});

describe('a fouc id never names a file outside the project', () => {
	it.each([
		'/etc/passwd',
		'%2Fetc%2Fpasswd',
		'\\windows\\win.ini',
		'%5Cwindows%5Cwin.ini',
		'C:\\secret.svelte',
		'c:/secret.svelte',
		'..',
		'../secret.svelte',
		'..%2F..%2Fetc%2Fpasswd',
		'src/../../secret.svelte',
		'src%2F..%2F..%2Fsecret.svelte',
		'src\\..\\..\\secret.svelte',
		'src/..'
	])('%s', (rel) => {
		expect(foucRelFromId(`${FOUC_SCOPED_PREFIX}${rel}.css`)).toBe(null);
		expect(foucRelFromId(`${FOUC_CSS_PREFIX}${rel}.js`)).toBe(null);
	});

	it.each(['src/..a/A.svelte', 'src/a../A.svelte', 'src/.../A.svelte'])(
		'%s is a plain name, kept',
		(rel) => {
			expect(foucRelFromId(foucScopedVirtualId(rel))).toBe(rel);
		}
	);
});

describe('the unscoped fallback unwraps :global(…)', () => {
	it('keeps the selector inside, nested parentheses and all', () => {
		// `{` unclosed in the markup: the component does not compile, so its style bodies ship raw
		const css = compileFoucScopedCss(
			'/app/src/lib/Broken.svelte',
			'<div>{</div>\n<style>:global(.a:not(.b)) { color: red; } .c :global(.d) { margin: 0; }</style>'
		);
		expect(css).toContain('.a:not(.b) { color: red; }');
		expect(css).toContain('.c .d { margin: 0; }');
		expect(css).not.toContain(':global');
	});
});
