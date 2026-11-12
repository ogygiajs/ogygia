// Properties of the frontmatter reader, over generated inputs rather than picked ones:
// - any text at all is read, or refused with the one coded error (`content_frontmatter_invalid`):
//   never another throw, a stack overflow or a change to Object.prototype;
// - a flat map of plain keys to quoted strings, numbers and booleans reads back as written.
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { parseFrontmatter } from '../src/markdown/frontmatter.ts';
import { OgygiaError } from '../src/messages/build.ts';
import { dedent } from '@ogygia/core/plugin/utils';

/** The code of a coded error, else undefined. */
const code_of = (e: unknown) =>
	e instanceof OgygiaError ? (e as { code?: string }).code : undefined;
/** A character a quoted YAML scalar may carry as itself (no control or line-separator). */
const plain_char = (c: string) => {
	const n = c.charCodeAt(0);
	return n > 0x1f && (n < 0x7f || n > 0x9f) && n !== 0x2028 && n !== 0x2029;
};

/** YAML-ish text built from the pieces the parser looks for. */
const yamlish = fc
	.array(
		fc.oneof(
			fc.constantFrom(
				'\n',
				'  ',
				'\t',
				'- ',
				': ',
				'key',
				'__proto__',
				'constructor',
				'{',
				'}',
				'[',
				']',
				', ',
				'"',
				"'",
				'\\',
				'#',
				'|',
				'>',
				'&a',
				'*a',
				'---'
			),
			fc.string({ maxLength: 5 })
		),
		{ maxLength: 40 }
	)
	.map((parts) => parts.join(''));

describe('frontmatter', () => {
	it('any text reads, or is refused with content_frontmatter_invalid only', () => {
		const before = Object.getOwnPropertyNames(Object.prototype).sort();
		fc.assert(
			fc.property(fc.oneof(yamlish, fc.string()), fc.string({ maxLength: 8 }), (yaml, body) => {
				try {
					const { data } = parseFrontmatter(dedent`
						---
						${yaml}
						---
						${body}
					`);
					expect(typeof data).toBe('object');
				} catch (e) {
					expect(code_of(e)).toBe('content_frontmatter_invalid');
				}
				expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
			}),
			{ numRuns: 3000 }
		);
	});

	it('deep nesting is read or refused, never a stack overflow', () => {
		for (const yaml of [
			`a: ${'['.repeat(20_000)}`,
			`a: ${'{b: '.repeat(20_000)}`,
			Array.from({ length: 5_000 }, (_, i) => `${' '.repeat(i)}k:`).join('\n'),
			Array.from({ length: 5_000 }, (_, i) => `${' '.repeat(i)}- `).join('\n')
		]) {
			try {
				parseFrontmatter(['---', yaml, '---', ''].join('\n'));
			} catch (e) {
				expect(code_of(e)).toBe('content_frontmatter_invalid');
			}
		}
	});

	it('a flat map of plain keys to quoted strings, numbers and booleans reads back as written', () => {
		const key = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/);
		const value = fc.oneof(
			fc.string().filter((s) => [...s].every(plain_char)),
			fc.integer(),
			fc.boolean()
		);
		fc.assert(
			fc.property(fc.dictionary(key, value, { maxKeys: 6 }), (map) => {
				const yaml = Object.entries(map)
					.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
					.join('\n');
				expect(parseFrontmatter(['---', yaml, '---', 'body'].join('\n'))).toEqual({
					data: map,
					body: 'body'
				});
			}),
			{ numRuns: 1000 }
		);
	});
});
