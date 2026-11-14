// A bad frontmatter block reports one coded error: one `[ogygia]`, one link.
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/markdown/frontmatter.ts';
import { dedent } from '@ogygia/core/plugin/utils';

const caught = (fn: () => unknown): Error & { code?: string } => {
	try {
		fn();
	} catch (e) {
		return e as Error & { code?: string };
	}
	throw new Error('expected a throw');
};

describe('invalid frontmatter is reported once', () => {
	for (const [name, block, says] of [
		['an empty key', ': x', 'empty mapping key in line: ": x"'],
		['a tab indent', 'a:\n\tb: 1', 'tabs are not allowed for indentation']
	] as const) {
		it(`${name}: content_frontmatter_invalid with one [ogygia] prefix and one link, naming what the parser stopped at`, () => {
			const e = caught(() =>
				parseFrontmatter(dedent`
				---
				${block}
				---
				body
			`)
			);
			expect(e.code).toBe('content_frontmatter_invalid');
			expect(e.message.match(/\[ogygia\]/g)).toHaveLength(1);
			expect(e.message.match(/https:\/\/ogygiajs\.dev\/e\//g)).toHaveLength(1);
			expect(e.message.split('\n')[0]).toBe(`[ogygia] invalid frontmatter YAML: ${says}`);
		});
	}

	it('a block the parser itself calls invalid is said once, not wrapped in a second invalid-frontmatter error', () => {
		const e = caught(() =>
			parseFrontmatter(dedent`
			---
			tags: [see [a, b]]
			---
			body
		`)
		);
		expect(e.code).toBe('content_frontmatter_invalid');
		expect(e.message.match(/\[ogygia\]/g)).toHaveLength(1);
		expect(e.message.split('\n')[0]).toBe(
			'[ogygia] invalid frontmatter YAML: a `[` inside a list or map item (`[see [a, b]]`): quote the item, or the whole value'
		);
	});
});
