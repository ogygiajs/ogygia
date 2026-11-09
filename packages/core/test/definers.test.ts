// A plugin's definer calls, marked in dev (vite/definers.ts): in a server module, each call of a
// definer a plugin names (`b.definers(module, names)`) goes through the module run's wrapper, asked
// for once at the top of the module, so the run owns what the call defines (and a module's next run
// ends it: a definition deleted from the code is gone).
import { describe, expect, it } from 'vitest';
import { mark_definer_calls } from '../src/vite/definers.ts';

const DEFINERS = [
	{ module: '@ogygia/content', names: ['content'] },
	{ module: '@ogygia/flags', names: ['flag'] }
];
const mark = (code: string) => mark_definer_calls(code, '/app/src/lib/docs.server.ts', DEFINERS);

describe('mark_definer_calls', () => {
	it('marks a named, a renamed and a namespace definer call, and asks for the run once', () => {
		const out = mark(
			[
				`import { content, folder } from '@ogygia/content';`,
				`import { content as collection } from '@ogygia/content';`,
				`import * as c from '@ogygia/content';`,
				`import { flag } from '@ogygia/flags';`,
				`export const a = content({ loader: folder({}) });`,
				`export const b = collection({ loader: folder({}) });`,
				`export const n = c.content({ loader: c.folder({}) });`,
				`export const lazy = () => content({ loader: folder({}) });`,
				`export const f = flag('hero', 0.5);`
			].join('\n')
		)!;
		expect(out.code.match(/\?\.run\?\.\("\/app\/src\/lib\/docs\.server\.ts"\)/g)).toHaveLength(1);
		expect(out.code).toContain('a = __og_define(content)({');
		expect(out.code).toContain('b = __og_define(collection)({');
		expect(out.code).toContain('n = __og_define(c.content)({');
		expect(out.code).toContain('lazy = () => __og_define(content)({');
		expect(out.code).toContain(`f = __og_define(flag)('hero', 0.5)`);
		// what is not a definer: left as written
		expect(out.code).toContain('loader: folder({})');
		expect(out.code).toContain('loader: c.folder({})');
		expect(out.map.mappings).not.toBe('');
	});

	it('marks a module still in TypeScript the same, at the same offsets', () => {
		const out = mark(
			`import { content } from '@ogygia/content';\nexport const a: unknown = content<{ x: 1 }>({ loader: {} as never });`
		)!;
		expect(out.code).toContain('a: unknown = __og_define(content)<{ x: 1 }>({');
	});

	it('leaves a module alone that does not parse (mid-edit)', () => {
		expect(mark(`import { content } from '@ogygia/content';\ncontent({`)).toBeNull();
	});

	it('leaves a module alone that calls no definer', () => {
		expect(mark(`import { folder } from '@ogygia/content';\nfolder({});`)).toBeNull();
		expect(mark(`import { content } from './mine.ts';\ncontent({});`)).toBeNull();
		expect(mark(`import { content } from '@ogygia/content';\nexport { content };`)).toBeNull();
		// a name another plugin defines, imported from the wrong module
		expect(mark(`import { flag } from '@ogygia/content';\nflag('x');`)).toBeNull();
	});
});
