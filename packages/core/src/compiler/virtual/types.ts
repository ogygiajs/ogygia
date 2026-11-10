/**
 * The per-realm `.d.ts` files, written from the table's entries (their `types`): one file per
 * realm, so the declarations an import sees are the ones the module it reaches exports.
 * `scripts/virtual-types.ts` writes them to `virtual/<realm>.d.ts`; a test fails when they drift.
 */
import { specifier, type Entry, type ModuleEntry, type Realm } from './table.ts';

export const REALMS: readonly Realm[] = ['server', 'boot', 'region', 'dev'];

const HEADER = (realm: Realm): string =>
	`// The \`ogygia:${realm}/…\` modules. GENERATED from the virtual-module table
// (packages/core/src/compiler/virtual/core.ts): change an entry's \`types\` there, then run
// \`node packages/core/scripts/virtual-types.ts\`. A test fails while this file is stale.
`;

const indent = (body: string): string =>
	body
		.split('\n')
		.map((l) => (l ? '\t' + l : l))
		.join('\n');

const declare = (name: string, body: string | undefined): string =>
	body ? `declare module '${name}' {\n${indent(body)}\n}\n` : `declare module '${name}' {}\n`;

/** The `.d.ts` text of each realm (a family declares no module: its members are generated per file). */
export function virtual_types<A>(entries: readonly Entry<A>[]): Record<Realm, string> {
	const out = {} as Record<Realm, string>;
	for (const realm of REALMS) {
		let text = HEADER(realm);
		for (const e of entries) {
			if (e.kind === 'constant' || e.realm !== realm) continue;
			if (e.kind === 'family' && (e.parse || !e.load)) continue;
			const m = e as ModuleEntry<A>;
			text += '\n' + declare(specifier(realm, m.id), m.types);
			if (m.alias) text += declare(m.alias, m.types);
		}
		out[realm] = text;
	}
	return out;
}
