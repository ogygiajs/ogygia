// On Windows a component on another drive than the app root has no root-relative path at all, so it
// never rides the fouc module either.
import { expect, test, vi } from 'vitest';
import '../src/compiler/messages.ts';

vi.doMock('node:path', async () => {
	const real = await vi.importActual<typeof import('node:path')>('node:path');
	return { ...real.win32, default: real.win32 };
});
const { buildFoucCssModuleSource } = await import('../src/compiler/fouc-css.ts');

test('a styled component on another drive than the root is left out', async () => {
	const files: Record<string, string> = {
		'C:\\app\\src\\lib\\Page.svelte': `<script>import O from 'other';</script><O />`,
		'D:\\o\\O.svelte': `<i class="o"></i><style>.o { color: red }</style>`
	};
	const src = await buildFoucCssModuleSource('C:\\app\\src\\lib\\Page.svelte', {
		root: 'C:\\app',
		libDir: 'C:\\app\\src\\lib',
		readFile: (p) => files[p] ?? null,
		resolve: async (spec) => (spec === 'other' ? 'D:\\o\\O.svelte' : null)
	});
	expect(src).toBe('export {}');
});

test('the same component on the root drive rides it', async () => {
	const files: Record<string, string> = {
		'C:\\app\\src\\lib\\Page.svelte': `<script>import O from 'other';</script><O />`,
		'C:\\app\\src\\lib\\O.svelte': `<i class="o"></i><style>.o { color: red }</style>`
	};
	const src = await buildFoucCssModuleSource('C:\\app\\src\\lib\\Page.svelte', {
		root: 'C:\\app',
		libDir: 'C:\\app\\src\\lib',
		readFile: (p) => files[p] ?? null,
		resolve: async (spec) => (spec === 'other' ? 'C:\\app\\src\\lib\\O.svelte' : null)
	});
	expect(src).toContain(encodeURIComponent('src/lib/O.svelte'));
});
