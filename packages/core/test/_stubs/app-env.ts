// Test stub for Kit's `$app/env`.
export let building = false;
/** A suite that renders as the build's prerender does sets it, and clears it after. */
export function set_building(value: boolean): void {
	building = value;
}
export const browser = false;
export const dev = false;
export const version = 'test';
