/**
 * The per-realm `.d.ts` files of the virtual-module table. Nothing in them is typed by hand: each
 * declaration points TypeScript at the code that knows the module.
 *
 *   value    its default export is `ValueOf<typeof entry>`: what the entry's `from` returns
 *   request  re-exports the functions from the real module, so its own types are the types
 *   family   `ModuleOf<typeof entry>`: the `contract/` interface the entry is typed with
 *
 * The files sit at `packages/core/virtual/`, beside `dist/`, and point into the built package (the
 * same place in the workspace and in the published one). `scripts/virtual-types.ts` writes them; a
 * test fails while they are stale. An entry's alias is declared from the same entry, until step 5
 * of #486 drops the aliases.
 */
import { dedent } from '../dedent.ts';
import { specifier, type Entry, type ModuleEntry, type Realm } from './table.ts';

export const REALMS: readonly Realm[] = ['server', 'boot', 'region', 'dev'];

/** Where the generated files reach the built package from. */
const DIST = '../dist';
const TABLE = `import('${DIST}/compiler/virtual/table.js')`;
/** Core's entries, built (./core.ts). */
export const CORE_ENTRIES_PATH: string = `${DIST}/compiler/virtual/core.js`;

/** One module's declaration body, by the entry's kind; `entries` is the module the entry is
 *  exported from (its built path), `name` its export name there. */
function body(e: ModuleEntry<unknown>, entries: string, name: string): string {
	const entry = `typeof import('${entries}').${name}`;
	if (e.kind === 'value')
		return dedent`
			const value: ${TABLE}.ValueOf<${entry}>;
			export default value;
		`;
	if (e.kind === 'request') {
		const from = 'core' in e.module ? `${DIST}/${e.module.core}.js` : e.module.package;
		return `export { ${e.exports.join(', ')} } from '${from}';`;
	}
	return dedent`
		const module: ${TABLE}.ModuleOf<${entry}>;
		export = module;
	`;
}

const declare = (name: string, text: string): string =>
	dedent`
		declare module '${name}' {
		${text}
		}
	` + '\n';

/**
 * The `.d.ts` text of each realm. `entries` is the module that exports the table's entries, by
 * export name (`entries_path`: its built path, relative to the generated files). A prefix family
 * declares nothing: its members are generated per file.
 */
export function virtual_types<A>(
	entries: Record<string, unknown>,
	entries_path: string
): Record<Realm, string> {
	const out = {} as Record<Realm, string>;
	for (const realm of REALMS) {
		let text = dedent`
			// The \`ogygia:${realm}/…\` modules. GENERATED from the virtual-module table
			// (packages/core/src/compiler/virtual/core.ts) by \`node packages/core/scripts/virtual-types.ts\`;
			// every type is read off the code (see src/compiler/virtual/types.ts). Do not edit.
		`;
		text += '\n\n';
		// (by export name: a module namespace's key order depends on the loader)
		for (const [name, value] of Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1))) {
			const e = value as Entry<A>;
			if (typeof e !== 'object' || e === null || !('kind' in e) || e.kind === 'constant') continue;
			if (e.realm !== realm || (e.kind === 'family' && (e.parse || !e.load))) continue;
			const b = body(e as ModuleEntry<unknown>, entries_path, name);
			text += declare(specifier(realm, e.id), b);
			if (e.alias) text += declare(e.alias, b);
		}
		out[realm] = text;
	}
	return out;
}
