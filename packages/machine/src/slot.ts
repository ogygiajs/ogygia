/**
 * slot(): ONE VALUE PER PROCESS (or page), shared by every copy of a package it loads. Dev serves
 * the runtime twice, and an app can bundle two copies of a package; state that must be one (a
 * registry, the request facts, a message table) lives in a slot, not in a module's own variable.
 *
 *   const facts = slot({ name: 'ogygia.facts', version: 2, make: () => ({ by_request: new WeakMap() }) });
 *
 * - The value lives at `globalThis[Symbol.for(name)]`.
 * - `version` is the value's shape, and the only place a version lives: a name carries none. A
 *   copy that asks for another version of a name already held is refused in dev
 *   (`machine_slot_version`, both versions named); in production it keeps a private value of its
 *   own, said once, instead of reading a value of the wrong shape.
 * - A name starts with `ogygia.`: every slot is ours, and spelled where it is made.
 */
import { DEV } from 'esm-env';
import { machine_error, warn_once } from './messages.ts';

type Global = Record<symbol, unknown>;

/** What {@link slot} takes. */
export interface SlotOptions<T extends object> {
	/** `ogygia.<what>`, with no version in it. */
	name: `ogygia.${string}`;
	/** The shape of the value: a whole number, raised when the shape changes. */
	version: number;
	/** Makes the value, the first time. */
	make: () => T;
}

/** The version each slot name was made at, shared like the slots themselves. */
const VERSIONS = Symbol.for('ogygia.slot.versions');
/** A version spelled into a name (`.v2`, `_v1`): the version belongs in `version`. */
const VERSIONED_NAME = /[._]v\d+$/;

/** The value of the slot `name` at shape `version`, made by `make` the first time. */
export function slot<T extends object>({ name, version, make }: SlotOptions<T>): T {
	if (typeof name !== 'string' || !name.startsWith('ogygia.'))
		throw machine_error('machine_bad_option', {
			option: 'slot name',
			value: String(name),
			rule: 'a name that starts with `ogygia.`'
		});
	if (VERSIONED_NAME.test(name))
		throw machine_error('machine_bad_option', {
			option: 'slot name',
			value: name,
			rule: 'a name with no version in it (the version is `version`)'
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
