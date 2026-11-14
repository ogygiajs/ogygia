import { dedent } from '@ogygia/core/contract';
import {
	OGYGIA_SCHEME,
	realm_exports,
	specifier,
	specifier_of,
	value_names,
	type Entry,
	type Leg,
	type ModuleEntry,
	type Realm,
	type ValueEntry,
	type ValueNames
} from './table.ts';

/**
 * Each value entry's export names, by specifier: the keys of its `from` run once against `probe` (a
 * session and leg that read nothing off disk). Sorted by specifier, so the generated file is stable.
 */
export function probe_value_names<A>(
	entries: readonly Entry<A>[],
	probe: A,
	leg: Leg
): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	const values = entries.filter((e): e is ValueEntry<A, object> => e.kind === 'value');
	for (const e of values.sort((a, b) => (specifier_of(a) < specifier_of(b) ? -1 : 1)))
		out[specifier_of(e)] = Object.keys(e.from(probe, leg));
	return out;
}

/** The generated names module (./value-names.ts). */
export function value_names_source(names: Record<string, string[]>): string {
	const lines = Object.entries(names).map(
		([id, list]) => `\t${JSON.stringify(id)}: [${list.map((n) => JSON.stringify(n)).join(', ')}]`
	);
	return `${dedent`
		import type { ValueNames } from './table.ts';

		export const CORE_VALUE_NAMES: ValueNames = {
		${lines.join(',\n')}
		};
	`}\n`;
}

export const REALMS: readonly Realm[] = ['server', 'boot', 'region', 'dev'];

const CORE_DIST_FROM_VIRTUAL_DIR = '../dist';
const CONTRACT = `import('${CORE_DIST_FROM_VIRTUAL_DIR}/contract/virtual-modules.js')`;

const request_from = (e: ModuleEntry<unknown> & { kind: 'request' }): string =>
	'core' in e.module ? `${CORE_DIST_FROM_VIRTUAL_DIR}/${e.module.core}.js` : e.module.package;

const shape_of = (e: ModuleEntry<unknown>): string =>
	`${CONTRACT}.VirtualModules['${specifier_of(e)}']`;

function realm_lines(e: ModuleEntry<unknown>, value: ValueNames): string[] {
	const names = realm_exports(e, value);
	if (names.length === 0) return [];
	if (e.kind === 'request') {
		const list = names.map(([name, own]) => (own === name ? name : `${own} as ${name}`));
		return [`export { ${list.join(', ')} } from '${request_from(e)}';`];
	}
	return names.map(([name, own]) => `export const ${name}: ${shape_of(e)}['${own}'];`);
}

function own_body(e: ModuleEntry<unknown>, value: ValueNames): string {
	if (e.kind === 'value')
		return value_names(e, value)
			.map((n: string) => `export const ${n}: ${shape_of(e)}['${n}'];`)
			.join('\n');
	if (e.kind === 'request')
		return `export { ${[...new Set(Object.values(e.exports))].join(', ')} } from '${request_from(e)}';`;
	return dedent`
		const module: ${shape_of(e)};
		export = module;
	`;
}

const declare = (name: string, text: string): string =>
	`${dedent`
		declare module '${name}' {
		${text}
		}
	`}\n`;

/** The constants' globals (`declare const __OGYGIA_X__`), each typed by core's `VirtualConstants`. */
export function constant_types(entries: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [, value] of Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1))) {
		const e = value as { kind?: string; id?: string };
		if (typeof e !== 'object' || e === null || e.kind !== 'constant') continue;
		lines.push(`declare const ${e.id}: ${CONTRACT}.VirtualConstants['${e.id}'];`);
	}
	return `${dedent`
		// ogygia's switches, the \`define\`s its build inlines. GENERATED from the virtual-module
		// table's constants (packages/compiler/src/virtual/core.ts) by
		// \`node packages/compiler/scripts/virtual-types.ts\`. Do not edit.

		${lines.join('\n')}
	`}\n`;
}

/**
 * The `.d.ts` text of each realm. `entries` is the module that exports the table's entries, by
 * export name. A prefix family declares nothing: its members are generated per file.
 */
export function virtual_types<A>(
	entries: Record<string, unknown>,
	names: ValueNames
): Record<Realm, string> {
	const out = {} as Record<Realm, string>;
	const sorted = Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1));
	for (const realm of REALMS) {
		const realm_module: string[] = [];
		let own = '';
		for (const [, value] of sorted) {
			const e = value as Entry<A>;
			if (typeof e !== 'object' || e === null || !('kind' in e) || e.kind === 'constant') continue;
			if (e.realm !== realm || (e.kind === 'family' && (e.parse || !e.load))) continue;
			const m = e as ModuleEntry<unknown>;
			realm_module.push(...realm_lines(m, names));
			own += declare(specifier(realm, m.id), own_body(m, names));
		}
		out[realm] = dedent`
			// The \`ogygia:${realm}\` module and its entries' own ids. GENERATED from the virtual-module
			// table (packages/compiler/src/virtual/core.ts) by
			// \`node packages/compiler/scripts/virtual-types.ts\`; every type is core's contract
			// (src/contract/virtual-modules.ts). Do not edit.

			${declare(`${OGYGIA_SCHEME}${realm}`, realm_module.join('\n'))}${own}
		`;
	}
	return out;
}
