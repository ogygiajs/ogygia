// The content dev plugin's mark (#247): in a server module, each content() call imported from
// @ogygia/content goes through the module run's wrapper, asked for once at the top of the module.
import { describe, expect, it } from 'vitest';
import { parseAst } from 'vite';
import { mark_content_calls } from '../src/vite/hmr.ts';

const mark = (code: string) =>
	mark_content_calls(code, '/app/src/lib/docs.server.ts', parseAst(code));

describe('mark_content_calls', () => {
	it('marks a named, a renamed and a namespace content() call, and asks for the run once', () => {
		const out = mark(
			[
				`import { content, folder } from '@ogygia/content';`,
				`import { content as collection } from '@ogygia/content';`,
				`import * as c from '@ogygia/content';`,
				`export const a = content({ loader: folder({}) });`,
				`export const b = collection({ loader: folder({}) });`,
				`export const n = c.content({ loader: c.folder({}) });`,
				`export const lazy = () => content({ loader: folder({}) });`
			].join('\n')
		)!;
		expect(out.code.match(/module_run\?\.\("\/app\/src\/lib\/docs\.server\.ts"\)/g)).toHaveLength(
			1
		);
		expect(out.code).toContain('a = __og_content_run(content)({');
		expect(out.code).toContain('b = __og_content_run(collection)({');
		expect(out.code).toContain('n = __og_content_run(c.content)({');
		expect(out.code).toContain('lazy = () => __og_content_run(content)({');
		// what is not content(): left as written
		expect(out.code).toContain('loader: folder({})');
		expect(out.code).toContain('loader: c.folder({})');
		expect(out.map.mappings).not.toBe('');
	});

	it('leaves a module alone that calls no content() from @ogygia/content', () => {
		expect(mark(`import { folder } from '@ogygia/content';\nfolder({});`)).toBeNull();
		expect(mark(`import { content } from './mine.ts';\ncontent({});`)).toBeNull();
		expect(mark(`import { content } from '@ogygia/content';\nexport { content };`)).toBeNull();
	});
});
