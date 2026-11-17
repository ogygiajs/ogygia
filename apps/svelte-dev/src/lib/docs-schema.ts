import * as v from 'valibot';

const bracketed = v.pipe(
	v.array(v.string()),
	v.transform((items) => `[${items.join(', ')}]`)
);

export const docsSchema = v.object({
	title: v.optional(v.union([v.string(), bracketed]), '')
});
