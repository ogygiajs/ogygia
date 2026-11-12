/**
 * ONE HANDLING PER HOOK CALL, whichever copy hears it first. The runtime hands every plugin's hook
 * the same event object, and two plugins can feed the same page state: devtools and `testing()`
 * (whose realm is the injected testing engine, another copy of these modules) both write the hook
 * record and the beacon. Each role keeps one page-wide set of the calls it has handled.
 */
export type HookRole = 'record' | 'beacon';

/** Whether this is the first handling of hook call `e` for `role` on this page. */
export function first_handling(role: HookRole, e: object): boolean {
	const key = Symbol.for(`ogygia.hook-once.${role}`);
	const g = globalThis as { [k: symbol]: WeakSet<object> | undefined };
	const seen = (g[key] ??= new WeakSet());
	if (seen.has(e)) return false;
	seen.add(e);
	return true;
}
