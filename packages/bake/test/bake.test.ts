import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __set_build_cache_root, dedent } from '@ogygia/compiler';
import { rewrite_bake } from '../src/bake.ts';

__set_build_cache_root(fs.mkdtempSync(path.join(os.tmpdir(), 'og-bake-cache-')));
const NO_ALIAS = { alias: [], root: '/app' };

describe('rewrite_bake — validation (no execution)', () => {
	it('rejects a non-function argument', async () => {
		await expect(
			rewrite_bake('const x = import.meta.og.bake(42);', '/app/x.ts', NO_ALIAS)
		).rejects.toThrow(/the argument must be a function/);
	});
	it('rejects wrong arity', async () => {
		await expect(
			rewrite_bake('const x = import.meta.og.bake(() => 1, 2);', '/app/x.ts', NO_ALIAS)
		).rejects.toThrow(/takes exactly one argument/);
	});
	it('returns the same reference when there is no bake call', async () => {
		const src = 'export const x = 1;';
		expect(await rewrite_bake(src, '/app/x.ts', NO_ALIAS)).toBe(src);
	});
	it('ignores the marker inside a comment or string', async () => {
		const src = dedent`
				// import.meta.og.bake(() => 1)
				const s = "import.meta.og.bake(x)";
				export const y = 2;
			`;
		expect(await rewrite_bake(src, '/app/x.ts', NO_ALIAS)).toBe(src);
	});
});

describe('rewrite_bake — real build-time evaluation', () => {
	let dir: string;
	beforeAll(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-bake-e2e-'));
		fs.writeFileSync(
			path.join(dir, 'data.ts'),
			`export function buildNav(): { items: string[]; count: number; when: Date } {
				return { items: ['home', 'about'], count: 2, when: new Date(0) };
			}
			export const HELPER_ONLY = 7;`
		);
	});
	afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

	const opts = () => ({ alias: [], root: dir });

	it('executes an imported fn at build and inlines its devalue-serialized result (Date survives)', async () => {
		const src = dedent`
			import { buildNav } from './data';
			const nav = import.meta.og.bake(() => buildNav());
			export { nav };
		`;
		const out = await rewrite_bake(src, path.join(dir, 'mod.ts'), opts());
		expect(out).not.toContain('import.meta.og.bake');
		expect(out.replace(/\s/g, '')).toContain('items:["home","about"]');
		expect(out).toContain('new Date(0)');
	});

	it('awaits an async bake fn', async () => {
		const src = `const n = import.meta.og.bake(async () => 40 + 2);\nexport { n };`;
		const out = await rewrite_bake(src, path.join(dir, 'mod.ts'), opts());
		expect(out).toContain('const n = (42)');
	});

	it('drops an import that only fed a baked fn (ship the answer, not the computation)', async () => {
		const src = dedent`
			import { buildNav } from './data';
			const nav = import.meta.og.bake(() => buildNav().count);
			export { nav };
		`;
		const out = await rewrite_bake(src, path.join(dir, 'mod.ts'), opts());
		expect(out).not.toContain(`import { buildNav }`); // dead after baking → removed
		expect(out).toContain('const nav = (2)');
	});

	it('KEEPS an import still used outside the baked fn', async () => {
		const src = dedent`
			import { buildNav, HELPER_ONLY } from './data';
			const nav = import.meta.og.bake(() => buildNav().count);
			export const extra = HELPER_ONLY;
			export { nav };
		`;
		const out = await rewrite_bake(src, path.join(dir, 'mod.ts'), opts());
		expect(out).toContain(`import { buildNav, HELPER_ONLY } from './data';`);
		expect(out).toContain('const nav = (2)');
	});

	it('a non-serializable result is a build error naming the fix', async () => {
		const src = `const bad = import.meta.og.bake(() => () => 1);\nexport { bad };`;
		await expect(rewrite_bake(src, path.join(dir, 'mod.ts'), opts())).rejects.toThrow(
			/not serializable/
		);
	});
});

describe('rewrite_bake — dev: an edited input bakes fresh', () => {
	let dir: string;
	beforeAll(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-bake-dev-'));
	});
	afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
	const SRC = dedent`
		import { value } from './data';
		export const V = import.meta.og.bake(() => value());
	`;

	it('an edited data module bakes its new value, with the same entry text', async () => {
		const data = path.join(dir, 'data.ts');
		fs.writeFileSync(data, `export const value = () => 'first';`);
		const first = await rewrite_bake(SRC, path.join(dir, 'mod.ts'), {
			alias: [],
			root: dir
		});
		expect(first).toContain(`"first"`);
		fs.writeFileSync(data, `export const value = () => 'second';`);
		const second = await rewrite_bake(SRC, path.join(dir, 'mod.ts'), {
			alias: [],
			root: dir
		});
		expect(second).toContain(`"second"`);
	});

	it('names every module the bake bundled as a file to watch', async () => {
		const data = path.join(dir, 'data.ts');
		fs.writeFileSync(data, `export const value = () => 'watched';`);
		const watched: string[] = [];
		await rewrite_bake(SRC, path.join(dir, 'mod.ts'), {
			alias: [],
			root: dir,
			watch: (file) => watched.push(file)
		});
		expect(watched.map((f) => fs.realpathSync(f))).toContain(fs.realpathSync(data));
	});

	it('many bakes of one module at once all land, none breaks another', async () => {
		fs.writeFileSync(path.join(dir, 'shared.ts'), `export const shared = () => 'shared';`);
		const src = dedent`
			import { shared } from './shared';
			export const V = import.meta.og.bake(() => shared());
		`;
		const outs = await Promise.all(
			Array.from({ length: 8 }, () =>
				rewrite_bake(src, path.join(dir, 'race.ts'), { alias: [], root: dir })
			)
		);
		for (const out of outs) expect(out).toContain(`"shared"`);
	});
});
