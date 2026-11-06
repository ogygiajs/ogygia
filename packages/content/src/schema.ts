import type { SchemaLike } from './index.ts';
import { OgygiaError } from './messages/runtime.ts';

export async function parseSchema(
	schema: SchemaLike | undefined,
	data: unknown,
	label: string
): Promise<Record<string, unknown>> {
	if (!schema) return data as Record<string, unknown>;

	if (schema['~standard']) {
		const result = await schema['~standard'].validate(data);
		if ('issues' in result && result.issues) {
			const msgs = result.issues.map((i) => i.message ?? 'invalid').join('; ');
			throw new OgygiaError('content_schema_failed', { label, issues: msgs });
		}
		return ('value' in result ? result.value : data) as Record<string, unknown>;
	}

	if (typeof schema.parse === 'function') {
		try {
			return schema.parse(data) as Record<string, unknown>;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new OgygiaError('content_schema_failed', { label, issues: msg });
		}
	}

	throw new OgygiaError('content_schema_unsupported', { label });
}
