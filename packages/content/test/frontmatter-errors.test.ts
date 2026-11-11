// A bad frontmatter block reports one coded error: one `[ogygia]`, one link.
import { describe, expect, it } from 'vitest';
import { parseFrontmatter, parse_yaml } from '../src/markdown/frontmatter.ts';

const caught = (fn: () => unknown): Error & { code?: string } => {
	try {
		fn();
	} catch (e) {
		return e as Error & { code?: string };
	}
	throw new Error('expected a throw');
};

describe('invalid frontmatter is reported once', () => {
	for (const [name, block] of [
		['an empty key', ': x'],
		['a tab indent', 'a:\n\tb: 1']
	] as const) {
		it(`${name}: one [ogygia] prefix and one link, the same error as the markdown path`, () => {
			const e = caught(() => parseFrontmatter(`---\n${block}\n---\nbody`));
			expect(e.message.match(/\[ogygia\]/g)).toHaveLength(1);
			expect(e.message.match(/https:\/\/ogygiajs\.dev\/e\//g)).toHaveLength(1);
			const direct = caught(() => parse_yaml(block));
			expect(e.code).toBe(direct.code);
			expect(e.message).toBe(direct.message);
		});
	}
});
