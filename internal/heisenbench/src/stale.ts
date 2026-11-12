/**
 * STALE EXEMPTIONS: an exemption in internal/heisenbench/unmeasured.json whose id names no function
 * in the source any more (renamed, moved, deleted). It excuses nothing, and left in place it piles
 * up, so the gate fails on it (unmeasured.ts). An id names a function as Heisenbench's gate matches
 * it: the function's own id, or its place (`context_path`: the id without shape hashes and order
 * suffixes, `flights:0 > run` for `flights:0~3fa9c2 > run`). One that names a function a bench or a
 * test measures now is only listed: whether a test's inputs replay can differ between machines.
 */
export type Exemption = { id: string; reason: string };

/** The exemptions whose id names no function of `inventory` (Heisenbench `inventory`'s output),
 *  by its id or by its place (`context_path`, Heisenbench identity.ts). */
export function gone_exemptions(
	exempt: readonly Exemption[],
	inventory: { functions: readonly { id: string }[] },
	context_path: (id: string) => string
): Exemption[] {
	const named = new Set<string>();
	for (const f of inventory.functions) {
		// the function and every place it sits in (an exemption of an enclosing call covers it),
		// never the module alone
		let id = f.id;
		while (id.includes(' > ')) {
			named.add(id);
			named.add(context_path(id));
			id = id.slice(0, id.lastIndexOf(' > '));
		}
	}
	return exempt.filter((e) => !named.has(e.id));
}
