/**
 * slot(): ONE VALUE PER PROCESS (or page), shared by every copy of a package it loads. Dev serves
 * the runtime twice, and an app can bundle two copies of a package; state that must be one (a
 * registry, the request facts, a message table) lives in a slot, not in a module's own variable.
 *
 *   const facts = slot('ogygia.facts.v2', 2, () => ({ by_request: new WeakMap() }));
 *
 * - The value lives at `globalThis[Symbol.for(name)]`, where the hand-written slots lived, so a copy
 *   that predates `slot()` shares it.
 * - `version` is the value's shape. A copy that asks for another version of a name already held is
 *   refused in dev (`machine_slot_version`, both versions named); in production it keeps a private
 *   value of its own, said once, instead of reading a value of the wrong shape.
 * - A name starts with `ogygia.`: every slot is ours, and spelled where it is made.
 */
import { DEV } from 'esm-env';
import { machine_error, warn_once } from './messages.ts';

type Global = Record<symbol, unknown>;

/** The version each slot name was made at, shared like the slots themselves. */
const VERSIONS = Symbol.for('ogygia.slot.versions');

/** The value of the slot `name` at shape `version`, made by `make` the first time. */
export function slot<T extends object>(
	name: `ogygia.${string}`,
	version: number,
	make: () => T
): T {
	if (typeof name !== 'string' || !name.startsWith('ogygia.'))
		throw machine_error('machine_bad_option', {
			option: 'slot name',
			value: String(name),
			rule: 'a name that starts with `ogygia.`'
		});
	if (!Number.isInteger(version) || version < 1)
		throw machine_error('machine_bad_option', {
			option: 'slot version',
			value: String(version),
			rule: 'a whole number, 1 or more'
		});
	const g = globalThis as unknown as Global;
	const versions = (g[VERSIONS] ??= Object.create(null)) as Record<string, number>;
	const have = versions[name];
	if (have !== undefined && have !== version) {
		const a = { name, have: String(have), want: String(version) };
		if (DEV) throw machine_error('machine_slot_version', a);
		warn_once('machine_slot_version', a);
		return make();
	}
	versions[name] = version;
	return (g[Symbol.for(name)] ??= make()) as T;
}
