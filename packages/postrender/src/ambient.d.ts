// SvelteKit's `$app/env`, resolved by the app's own Kit at build time.
declare module '$app/env' {
	export const building: boolean;
	export const dev: boolean;
}
