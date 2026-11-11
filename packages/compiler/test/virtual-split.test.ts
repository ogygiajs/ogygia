/**
 * A realm module is the API, never a node of the bundle's graph: a page that imports names from
 * `ogygia:boot` gets the same chunks, with the same modules in them, as one that imports each name
 * from the entry module that has it. Without the split (the realm module as one shared node), a
 * fixture app's Kit-owned page got one more shared chunk, and code moved between chunks.
 */
import { describe, expect, it } from 'vitest';
import { rolldown, type Plugin } from 'rolldown';
import { VirtualTable } from '../src/compiler/virtual/resolver.ts';
import { virtual } from '../src/compiler/virtual/table.ts';

const table = new VirtualTable<null>(
	[
		virtual.value({
			realm: 'boot',
			id: 'a',
			from: () => ({ alpha: 1 })
		}),
		virtual.value({
			realm: 'boot',
			id: 'b',
			from: () => ({ beta: 2 })
		}),
		virtual.family<null, { gamma(): number }>({
			realm: 'boot',
			id: 'c',
			exports: { gamma: 'gamma' },
			load: () => 'export function gamma() { return 3; }'
		})
	],
	() => '',
	{ 'ogygia:boot/a': ['alpha'], 'ogygia:boot/b': ['beta'] },
	{}
);

/** The app: two entries sharing one name, each with one of its own, and a lazy third. */
const MODULE_OF: Record<string, string> = { alpha: 'a', beta: 'b', gamma: 'c' };

function app(realm_imports: boolean): Record<string, string> {
	const from = (names: string[]) =>
		realm_imports
			? `import { ${names.join(', ')} } from 'ogygia:boot';`
			: names.map((n) => `import { ${n} } from 'ogygia:boot/${MODULE_OF[n]}';`).join(' ');
	return {
		'/e1.js': `${from(['alpha', 'gamma'])}\nconsole.log(alpha, gamma());\nimport('/lazy.js');`,
		'/e2.js': `${from(['beta', 'gamma'])}\nconsole.log(beta, gamma());`,
		'/lazy.js': `${from(['alpha'])}\nexport const lazy = alpha;`
	};
}

function plugin(files: Record<string, string>): Plugin {
	return {
		name: 'virtual-test',
		resolveId: (source) => (source in files ? source : (table.resolve(source) ?? null)),
		load: (id) => {
			if (id in files) return files[id];
			const code = table.load(id, null, { ssr: false, universalHooks: null });
			if (typeof code !== 'string') return null;
			return { code, moduleSideEffects: table.side_effect_free(id) ? false : undefined };
		},
		transform: (code) => table.split_realm_imports(code)
	};
}

async function chunks(files: Record<string, string>): Promise<string[]> {
	const bundle = await rolldown({ input: ['/e1.js', '/e2.js'], plugins: [plugin(files)] });
	const { output } = await bundle.generate({ format: 'esm' });
	return output
		.filter((o) => o.type === 'chunk')
		.map((o) => `${o.isEntry ? 'entry' : 'shared'}: ${[...o.moduleIds].sort().join(' ')}`)
		.sort();
}

describe('a realm module’s names, imported per entry', () => {
	it('give the bundle the same chunks as direct imports of the entry modules', async () => {
		expect(table.split_realm_imports(app(true)['/e1.js'])).toBe(
			`import { alpha } from 'ogygia:boot/a'; import { gamma } from 'ogygia:boot/c';\nconsole.log(alpha, gamma());\nimport('/lazy.js');`
		);
		const direct = await chunks(app(false));
		const through_realm = await chunks(app(true));
		expect(through_realm).toEqual(direct);
		// the realm module is never a node of the graph
		expect(through_realm.join('\n')).not.toMatch(/ogygia:boot\b(?!\/)/);
	});
});
