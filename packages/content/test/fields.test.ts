// `fields.page`: what the site reads off a page, and nothing more.
import { describe, expect, it } from 'vitest';
import { fields } from '../src/site/fields.ts';

const validate = (data: unknown) =>
	(
		fields.page as unknown as {
			'~standard': { validate(v: unknown): { value?: unknown; issues?: { message: string }[] } };
		}
	)['~standard'].validate(data);

describe('fields.page', () => {
	it('keeps the page fields, fills their defaults, and drops anything else', () => {
		expect(validate({ title: 'Install', extra: 1, related: ['a', 2] })).toEqual({
			value: { title: 'Install', summary: '', draft: false, related: ['a'] }
		});
	});

	it('a page with no title is an issue, not a throw', () => {
		expect(validate({})).toEqual({
			issues: [{ message: 'frontmatter needs a non-empty `title`' }]
		});
	});
});
