/**
 * Why a barrel stayed, as both sides read it: the build records it (`compile.barrel.left`), the
 * dev server and the build's handoff attach it to a barrel row, the findings put it in words.
 */

/** Every reason, in the order a finding lists them. */
export const BARREL_LEFT_REASONS = [
	'impure',
	'kept',
	'outside-project',
	'opaque',
	'own',
	'ambiguous',
	'pinned',
	'namespace',
	'unparsable'
] as const;

/** Why an import stayed on its barrel: the barrel runs code of its own, the app keeps it, it lies
 *  outside the project, it hides names behind a module that cannot be read, it defines the name
 *  itself, it has two homes for the name, the import carries a region's identity, the import takes
 *  it whole, or the importer could not be parsed. */
export type BarrelLeftReason = (typeof BARREL_LEFT_REASONS)[number];

/** A barrel an island still imports whole, on the dev server: its file, the app modules behind it,
 *  and why the barrel pass left it (when it said). */
export interface IslandBarrel {
	file: string;
	fanout: number;
	why?: BarrelLeftReason[];
}
