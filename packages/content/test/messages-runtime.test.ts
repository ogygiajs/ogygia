// Where content's runtime messages carry their wording: dev and a prerender print it with the page;
// a production request prints the code's page alone, and a production browser bundle holds no
// wording at all.
import { afterEach, describe, expect, it, vi } from 'vitest';

const PRERENDERING = Symbol.for('ogygia.prerendering');
const flags = globalThis as unknown as Record<symbol, unknown>;

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
	delete flags[PRERENDERING];
});

const line_of = async () => {
	vi.resetModules();
	const { line } = await import('../src/messages/runtime.ts');
	return line('content_folder_empty_id', { key: 'docs/+doc.svx' });
};
const WORDING = "folder(): empty id for 'docs/+doc.svx'";
const PAGE = 'https://ogygiajs.dev/e/content_folder_empty_id';

describe('content runtime messages', () => {
	it('a prerender of a production build prints the wording, then the page', async () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('SSR', true);
		flags[PRERENDERING] = true;
		const text = await line_of();
		expect(text).toContain(WORDING);
		expect(text.indexOf(WORDING)).toBeLessThan(text.indexOf(PAGE));
	});

	it('a production request prints the page alone', async () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('SSR', true);
		const text = await line_of();
		expect(text).not.toContain('empty id');
		expect(text).toContain(PAGE);
	});

	it('a production browser bundle has no wording to print, even while prerendering', async () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('SSR', false);
		flags[PRERENDERING] = true;
		const text = await line_of();
		expect(text).not.toContain('empty id');
		expect(text).toContain(PAGE);
	});
});
