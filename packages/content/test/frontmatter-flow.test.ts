// A bracketed frontmatter value is a YAML flow sequence, one item or many.
import { describe, expect, it } from 'vitest';
import { parse_yaml, parseFrontmatter } from '../src/markdown/frontmatter.ts';
import { dedent } from '@ogygia/core/plugin/utils';

describe('flow sequences', () => {
	it('tags: [svelte] is a one-item list', () => {
		expect(parse_yaml('tags: [svelte]')).toEqual({ tags: ['svelte'] });
		expect(
			parseFrontmatter(dedent`
			---
			tags: [svelte]
			---
			body
		`).data
		).toEqual({ tags: ['svelte'] });
	});

	it('a bracketed phrase is a one-item list, as YAML reads it; quoted, it stays a string', () => {
		expect(parse_yaml('title: [create your own]')).toEqual({ title: ['create your own'] });
		expect(parse_yaml("title: '[create your own]'")).toEqual({ title: '[create your own]' });
	});

	it('one quoted item, one nested list, and many items', () => {
		expect(parse_yaml('a: ["x, y"]')).toEqual({ a: ['x, y'] });
		expect(parse_yaml('a: [[1]]')).toEqual({ a: [[1]] });
		expect(parse_yaml('tags: [a, b]')).toEqual({ tags: ['a', 'b'] });
		expect(parse_yaml('a: []')).toEqual({ a: [] });
	});

	it('a value that only starts with a bracketed part (a markdown link) stays text', () => {
		expect(parse_yaml('title: [docs](/docs)')).toEqual({ title: '[docs](/docs)' });
	});

	it('several bracket groups in a row (a reference link) stay text, not the first group as a list', () => {
		expect(parse_yaml('title: [docs][ref]')).toEqual({ title: '[docs][ref]' });
		expect(parse_yaml('title: [a] [b]')).toEqual({ title: '[a] [b]' });
	});

	it('a nested list as its own item parses, as YAML reads it', () => {
		expect(parse_yaml('a: [a, [b, c]]')).toEqual({ a: ['a', ['b', 'c']] });
		expect(parse_yaml('a: {k: [1, 2]}')).toEqual({ a: { k: [1, 2] } });
	});

	it('a bracket or brace inside a plain item is the frontmatter error, as YAML rejects it (#620)', () => {
		expect(() => parse_yaml('title: [see [a, b]]')).toThrow();
		expect(() => parse_yaml('a: [a {b}]')).toThrow();
		expect(() =>
			parseFrontmatter(dedent`
			---
			title: [see [a, b]]
			---
			body
		`)
		).toThrow(/content_frontmatter_invalid/);
	});
});
