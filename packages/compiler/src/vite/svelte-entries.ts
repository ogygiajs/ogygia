/** The Svelte entries the compiler names by module id: Vite pre-bundles them for a dev island, among
 *  them Svelte's private client runtime. test/canary/svelte-entries.test.ts resolves each in the
 *  installed Svelte's exports map (#1721). */
export const SVELTE_DEV_ISLAND_ENTRIES: readonly string[] = [
	'svelte',
	'svelte/internal/client',
	'svelte/server'
];
