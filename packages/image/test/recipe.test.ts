import { describe, expect, test } from 'vitest';
import { parse_recipe, recipe_path, source_tail, type Recipe } from '../src/recipe.ts';

const R: Recipe = { id: 'abc_-1', src: '/x', width: 640, height: 360, format: 'avif' };

describe('recipes', () => {
	test('a recipe path reads back as the recipe it was written from', () => {
		const full: Recipe = {
			...R,
			quality: 70,
			position: 'attention',
			ops: { grayscale: true, rotate: 90 }
		};
		const path = recipe_path(full, '_app/immutable/assets/hero.B1.jpg');
		expect(path).toMatch(
			/^abc_-1-640x360-q70-pattention-o[\w-]+\/_app\/immutable\/assets\/hero\.B1\.jpg\.avif$/
		);
		expect(parse_recipe(path)).toEqual({
			id: 'abc_-1',
			tail: '_app/immutable/assets/hero.B1.jpg',
			width: 640,
			height: 360,
			format: 'avif',
			quality: 70,
			position: 'attention',
			ops: { grayscale: true, rotate: 90 }
		});
	});

	test('a name with a space, an accent or a comma is escaped in the URL and read back as itself', () => {
		for (const name of ['my photo.jpg', 'café.jpg', 'a,b.jpg']) {
			const path = recipe_path(R, `src/blog/${name}`);
			expect(path).not.toMatch(/[ ,é]/);
			expect(parse_recipe(path)?.tail).toBe(`src/blog/${name}`);
		}
	});

	test('a tail that climbs out of its folder is no recipe', () => {
		expect(parse_recipe('abc-1x1/_app/../server/index.js.avif')).toBeNull();
		expect(parse_recipe('abc-1x1/_app/%2E%2E/server/index.js.avif')).toBeNull();
		expect(parse_recipe('abc-1x1/../x.avif')).toBeNull();
	});

	test('a format the endpoint does not make, a zero size or a quality over 100 is no recipe', () => {
		expect(parse_recipe('abc-10x10/a.jpg.svg')).toBeNull();
		expect(parse_recipe('abc-0x10/a.jpg.avif')).toBeNull();
		expect(parse_recipe('abc-10x10-q101/a.jpg.avif')).toBeNull();
		expect(parse_recipe('abc-10x10-pmiddle/a.jpg.avif')).toBeNull();
		expect(parse_recipe('abc-10x10-o!!/a.jpg.avif')).toBeNull();
	});

	test('the tail is the asset path without origin, base, query or leading slash, decoded', () => {
		expect(source_tail('/shop/_app/immutable/assets/a%20b.jpg', ['', '/shop'])).toBe(
			'_app/immutable/assets/a b.jpg'
		);
		expect(
			source_tail('https://cdn.example.com/_app/immutable/assets/a.jpg', [
				'https://cdn.example.com',
				''
			])
		).toBe('_app/immutable/assets/a.jpg');
		expect(source_tail('/src/lib/a.jpg?no-inline', ['', ''])).toBe('src/lib/a.jpg');
	});
});
