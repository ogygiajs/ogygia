// A bracketed frontmatter value is a YAML flow sequence, one item or many.
import { describe, expect, it } from 'vitest';
import { parse_yaml, parseFrontmatter } from '../src/markdown/frontmatter.ts';

describe('flow sequences', () => {
	it('tags: [svelte] is a one-item list', () => {
		expect(parse_yaml('tags: [svelte]')).toEqual({ tags: ['svelte'] });
		expect(parseFrontmatter('---\ntags: [svelte]\n---\nbody').data).toEqual({ tags: ['svelte'] });
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
});
