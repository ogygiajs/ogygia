// Test stub for `ogygia:server/kit-env` (the real one reads Kit 3's `rendered_env`, resolved by the
// Vite plugin). `set_kit_public_env` sets what it answers (null: a Kit with none), and
// `set_kit_env_build` the identity it writes (a dev server's, which changes once an app gains its
// first dynamic public variable), and `kit_env_build_asks` how often it was asked. The browser
// fixture reads with `FIXTURE_BUILD` (test/browser/fixtures/reads-kit-env.ts).
export const FIXTURE_BUILD = 'fixture-build';
let build = FIXTURE_BUILD;
let asks = 0;
export const kit_env_build = (): string => (asks++, build);
export const kit_env_build_asks = (): number => asks;
export function set_kit_env_build(v: string) {
	build = v;
}
let env: Record<string, unknown> | null = null;
export const kit_public_env = (): Record<string, unknown> | null => env;
export function set_kit_public_env(v: Record<string, unknown> | null) {
	env = v;
}
