import * as v from 'valibot';

export const docsSchema = v.object({ title: v.optional(v.string(), '') });
