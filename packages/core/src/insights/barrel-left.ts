/**
 * Why a barrel an island imports whole was left by the barrel pass, in plain words: the reasons the
 * pass told the build (`compile.barrel.left`), and what to do about each. The dock's finding and the
 * profiler's both say it.
 */
import type { BarrelLeftReason } from '../contract/barrels.ts';

export type { BarrelLeftReason };
export type { IslandBarrel } from '../contract/barrels.ts';
export type { ChunkBarrel } from '../contract/virtual-modules.ts';

const WORDS: Record<BarrelLeftReason, string> = {
	impure: 'it runs code of its own besides its re-exports',
	kept: 'barrels({ keep }) lists it',
	'outside-project': 'it is a package, and barrels({ packages }) does not list it',
	opaque: 'it re-exports from a module that cannot be read, so some names have no known home',
	own: 'the names are defined in the barrel itself',
	ambiguous: 'two of its `export *` lines give the same name',
	pinned: 'an import of it marks a region, and a region import stays as written',
	namespace: 'it is imported whole (`import * as`)',
	unparsable: 'a component that imports it could not be parsed'
};

const FIXES: Record<BarrelLeftReason, string> = {
	impure: "move the barrel's own code into a module of its own, or list it in barrels({ force })",
	kept: 'take it out of barrels({ keep })',
	'outside-project': 'list the package in barrels({ packages })',
	opaque: 'import those names from their own files',
	own: 'move those names into files of their own',
	ambiguous: 'export the name from one place only',
	pinned: 'import the region from its own file',
	namespace: 'import the names the island uses, not the whole barrel',
	unparsable: 'fix the component the build log names (barrels_component_skipped)'
};

/** `barrels() left it: …`, or '' when the pass said nothing about this barrel. */
export function barrel_left_words(why: readonly BarrelLeftReason[] | undefined): string {
	return why?.length ? `barrels() left it: ${why.map((r) => WORDS[r]).join('; ')}` : '';
}

/** The fix for a barrel an island imports whole: by its reasons, or (none known) add the pass. */
export function barrel_left_fix(why: readonly BarrelLeftReason[] | undefined): string {
	const first = 'Import what the island uses from its own file';
	if (!why?.length)
		return `${first}, or add barrels() from @ogygia/barrels to the Vite plugins, beside ogygia().`;
	return `${first}; or ${why.map((r) => FIXES[r]).join('; or ')}.`;
}
