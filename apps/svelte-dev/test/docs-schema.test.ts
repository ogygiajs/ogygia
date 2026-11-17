import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { parseFrontmatter } from '@ogygia/content/markdown';
import { docsSchema } from '../src/lib/docs-schema.ts';

const title_of = (field: string) =>
	v.parse(docsSchema, parseFrontmatter(['---', field, '---', 'body'].join('\n')).data).title;

describe('docs frontmatter', () => {
	it('a bracketed title upstream writes unquoted reads as svelte.dev shows it', () => {
		expect(title_of('title: [create your own]')).toBe('[create your own]');
	});

	it('a plain title stays as written, and a missing one is empty', () => {
		expect(title_of('title: Introduction')).toBe('Introduction');
		expect(title_of('other: x')).toBe('');
	});
});
