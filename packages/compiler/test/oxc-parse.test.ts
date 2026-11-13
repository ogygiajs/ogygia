import { describe, expect, it, vi } from 'vitest';

describe('parse_module', () => {
	it('reads TypeScript, with every span exact against the source', async () => {
		const { parse_module } = await import('../src/compiler/parse/oxc.ts');
		const code = `const a: number = 1;\nexport const b = <T,>(x: T) => x;`;
		const r = parse_module(code, '/a/b.ts');
		expect(r.ok).toBe(true);
		const decl = r.program!.body[1].declaration.declarations[0];
		expect(code.slice(decl.start, decl.end)).toBe('b = <T,>(x: T) => x');
	});

	it('is null, never a throw, on a syntax error', async () => {
		const { parse_module } = await import('../src/compiler/parse/oxc.ts');
		expect(parse_module(`const a = (;`, '/a/b.ts')).toMatchObject({ program: null, ok: false });
	});

	it('a module that imports the parser without parsing never loads vite', async () => {
		vi.resetModules();
		vi.doMock('vite', () => {
			throw new Error('vite loaded');
		});
		try {
			const mod = await import('../src/compiler/parse/oxc.ts');
			expect(typeof mod.parse_module).toBe('function');
		} finally {
			vi.doUnmock('vite');
			vi.resetModules();
		}
	});
});
