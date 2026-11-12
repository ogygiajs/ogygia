import { describe, it, expect } from 'vitest';
import { compile, compile_all, fill, match_one, match_path } from '../src/match.ts';

describe('router pattern matching', () => {
	it('matches root, static, and params', () => {
		expect(match_one(compile('/'), '/')).toEqual({ pattern: '/', params: {} });
		expect(match_one(compile('/docs/new'), '/docs/new')).toEqual({
			pattern: '/docs/new',
			params: {}
		});
		expect(match_one(compile('/docs/new'), '/docs/old')).toBeNull();
		expect(match_one(compile('/docs/[slug]'), '/docs/intro')).toEqual({
			pattern: '/docs/[slug]',
			params: { slug: 'intro' }
		});
	});

	it('is trailing-slash-insensitive and decodes params', () => {
		expect(match_one(compile('/docs/[slug]'), '/docs/intro/')!.params).toEqual({ slug: 'intro' });
		expect(match_one(compile('/u/[name]'), '/u/a%20b')!.params).toEqual({ name: 'a b' });
	});

	it('handles [...rest] (may be empty) and [[optional]]', () => {
		expect(match_one(compile('/files/[...path]'), '/files')!.params).toEqual({ path: '' });
		expect(match_one(compile('/files/[...path]'), '/files/a/b/c')!.params).toEqual({
			path: 'a/b/c'
		});
		expect(match_one(compile('/[[lang]]/docs'), '/docs')!.params).toEqual({ lang: undefined });
		expect(match_one(compile('/[[lang]]/docs'), '/en/docs')!.params).toEqual({ lang: 'en' });
	});

	it('orders overlapping routes static > param > rest', () => {
		const sorted = compile_all(['/docs/[slug]', '/docs/new', '/[...all]']);
		expect(sorted.map((c) => c.pattern)).toEqual(['/docs/new', '/docs/[slug]', '/[...all]']);
		expect(match_path(sorted, '/docs/new')!.pattern).toBe('/docs/new');
		expect(match_path(sorted, '/docs/xyz')!.pattern).toBe('/docs/[slug]');
		expect(match_path(sorted, '/anything/here')!.pattern).toBe('/[...all]');
	});

	it('REGRESSION: an empty-matching [...rest] must not shadow shorter routes', () => {
		// '/[...all]' matches '' too — depth-counting its rest segment ranked it ABOVE '/'
		// and the home route 404'd (found via the MFE fragment-mount POC's cms catchall).
		const s = compile_all(['/', '/[...all]', '/posts/[id]', '/old-blog']);
		expect(match_path(s, '/')!.pattern).toBe('/');
		expect(match_path(s, '/old-blog')!.pattern).toBe('/old-blog');
		expect(match_path(s, '/posts/1')!.pattern).toBe('/posts/[id]');
		expect(match_path(s, '/nope')!.pattern).toBe('/[...all]');
		// prefix beats its own rest extension; a genuinely deeper param still beats the rest
		const t = compile_all(['/docs/[...r]', '/docs', '/docs/[slug]']);
		expect(match_path(t, '/docs')!.pattern).toBe('/docs');
		expect(match_path(t, '/docs/x')!.pattern).toBe('/docs/[slug]');
		expect(match_path(t, '/docs/x/y')!.pattern).toBe('/docs/[...r]');
	});

	it('ranks a required [param] above an [[optional]] one in the same place', () => {
		const s = compile_all(['/[[lang]]/docs', '/[section]/docs']);
		expect(match_path(s, '/en/docs')!.pattern).toBe('/[section]/docs');
		expect(match_path(s, '/docs')!.pattern).toBe('/[[lang]]/docs');
	});

	it('distinguishes dot-suffixed and nested variants (the profiler /report cases)', () => {
		const s = compile_all(['/report/[id]', '/report/[id].json', '/report/[id]/raw']);
		expect(match_path(s, '/report/abc.json')!.pattern).toBe('/report/[id].json');
		expect(match_path(s, '/report/abc')!.pattern).toBe('/report/[id]');
		expect(match_path(s, '/report/abc/raw')!.pattern).toBe('/report/[id]/raw');
	});

	it('rejects malformed patterns loudly', () => {
		expect(() => compile('docs/[slug]')).toThrow(/must start with/);
		expect(() => compile('/a/[...rest]/b')).toThrow(/must be last/);
	});

	it('rejects a segment with a stray bracket left after its valid [param] groups', () => {
		expect(() => compile('/a/[b')).toThrow(/malformed segment/);
		expect(() => compile('/a/b]c')).toThrow(/malformed segment/);
		expect(() => compile('/a/[id]]')).toThrow(/malformed segment/);
	});

	it('hands back a param with a malformed %xx as it was, instead of throwing', () => {
		expect(match_one(compile('/u/[name]'), '/u/%E0%A4%A')!.params).toEqual({ name: '%E0%A4%A' });
	});

	it('fill() puts URL-encoded params into every token kind, and nothing for a missing one', () => {
		expect(fill('/[[lang]]/docs/[slug]/[...rest]', { lang: 'en', slug: 'a b', rest: 'x' })).toBe(
			'/en/docs/a%20b/x'
		);
		expect(fill('/docs/[slug]', {})).toBe('/docs/');
	});
});

describe('router pattern matching takes time in line with the path', () => {
	it('a segment with several params answers a long path that almost matches at once', () => {
		const c = [compile('/[a]-[b]-[c]')];
		const near_miss = `/${'-'.repeat(2000)}/x`;
		const t = performance.now();
		expect(match_path(c, near_miss)).toBeNull();
		expect(performance.now() - t).toBeLessThan(100);
	});

	it('several params in a segment split at the first separator, the last param takes the rest', () => {
		expect(match_one(compile('/[a]-[b]-[c]'), '/x-y-z')!.params).toEqual({
			a: 'x',
			b: 'y',
			c: 'z'
		});
		expect(match_one(compile('/[a]-[b]'), '/x-y-z')!.params).toEqual({ a: 'x', b: 'y-z' });
		// one param before its suffix keeps every character it had
		expect(match_one(compile('/[id].json'), '/a.b.json')!.params).toEqual({ id: 'a.b' });
	});

	it('a param may hold the first character of the literal after it (#833)', () => {
		expect(match_one(compile('/[a]-x-[b]'), '/p-q-x-r')!.params).toEqual({ a: 'p-q', b: 'r' });
		expect(match_one(compile('/[slug]-[id]'), '/my-post-42')!.params).toEqual({
			slug: 'my',
			id: 'post-42'
		});
	});

	it('every short path splits as SvelteKit lazy params would (#833)', () => {
		// the reference is Kit's own shape: each param `([^/]+?)`, fine on paths this short
		const kit = (pattern: string) =>
			new RegExp(
				`^${pattern.replace(/[.*+?^${}()|\\]/g, '\\$&').replace(/\[[a-z]\]/g, '([^/]+?)')}/?$`
			);
		const patterns = [
			'/[a]-[b]',
			'/[a]-x-[b]',
			'/[a]-[b]-[c]',
			'/[a][b]',
			'/x[a]-[b]x',
			'/[a]-[b]/[c]'
		];
		const paths: string[] = [''];
		for (let level = [''], n = 0; n < 7; n++) {
			level = level.flatMap((p) => [...'a-x/'].map((ch) => p + ch));
			paths.push(...level);
		}
		for (const pattern of patterns) {
			const c = compile(pattern);
			for (const tail of paths) {
				const path = `/${tail}`;
				const want = kit(pattern).exec(path);
				const got = match_one(c, path);
				const want_params = want
					? Object.fromEntries(c.params.map((s, i) => [s.name, want[i + 1]]))
					: null;
				expect([pattern, path, got?.params ?? null]).toEqual([pattern, path, want_params]);
			}
		}
	});

	it('two params with nothing between them answer a long near miss at once (#833)', () => {
		const c = [compile('/[a][b]')];
		const t = performance.now();
		expect(match_path(c, `/${'a'.repeat(8000)}/x`)).toBeNull();
		expect(performance.now() - t).toBeLessThan(100);
	});

	it('a path longer than any route can mean matches nothing', () => {
		const c = compile_all(['/[...rest]']);
		expect(match_path(c, `/${'a'.repeat(20_000)}`)).toBeNull();
		expect(match_path(c, `/${'a'.repeat(2000)}`)).not.toBeNull();
	});
});
