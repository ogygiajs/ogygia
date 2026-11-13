/**
 * STALE EXEMPTIONS: an exemption in internal/heisenbench/unmeasured.json whose id names no function
 * in the source any more (renamed, moved, deleted). It excuses nothing, and left in place it piles
 * up, so the gate fails on it (unmeasured.ts). An id names a function as Heisenbench's gate matches
 * it: the function's own id, or its place (`context_path`: the id without shape hashes and order
 * suffixes, `flights:0 > run` for `flights:0~3fa9c2 > run`). One that names a function a bench or a
 * test measures now is only listed: whether a test's inputs replay can differ between machines.
 */
export type Exemption = { id: string; reason: string };

type Inventory = { functions: readonly { id: string }[] };

/** Every name a function answers to: its id and its place, for it and each call it sits in (an
 *  exemption of an enclosing call covers it), never the module alone. */
function names_of(id: string, context_path: (id: string) => string): string[] {
	const out: string[] = [];
	while (id.includes(' > ')) {
		out.push(id, context_path(id));
		id = id.slice(0, id.lastIndexOf(' > '));
	}
	return out;
}

/** The exemptions whose id names no function of `inventory` (Heisenbench `inventory`'s output),
 *  by its id or by its place (`context_path`, Heisenbench identity.ts). */
export function gone_exemptions(
	exempt: readonly Exemption[],
	inventory: Inventory,
	context_path: (id: string) => string
): Exemption[] {
	const named = new Set(inventory.functions.flatMap((f) => names_of(f.id, context_path)));
	return exempt.filter((e) => !named.has(e.id));
}

/** The functions of `inventory` whose place `base` does not have and no exemption names: what the
 *  gate fails on unless a bench or a replayable test measures them (`unmeasured.ts --ids-only`). */
export function unexempted_new_functions(
	inventory: Inventory,
	base: Inventory,
	exempt: readonly Exemption[],
	context_path: (id: string) => string
): { id: string }[] {
	const before = new Set(base.functions.map((f) => context_path(f.id)));
	const excused = new Set(exempt.map((e) => e.id));
	return inventory.functions.filter(
		(f) =>
			!before.has(context_path(f.id)) &&
			!names_of(f.id, context_path).some((n) => excused.has(n))
	);
}
