// Test stub for `ogygia:server/kit-env` (the real one reads Kit 3's `rendered_env`, resolved by the
// Vite plugin). `set_kit_public_env` sets what it answers (null: a Kit with none). The browser
// fixture reads with its build (test/browser/fixtures/reads-kit-env.ts).
export const kit_env_build = 'fixture-build';
let env: Record<string, unknown> | null = null;
export const kit_public_env = (): Record<string, unknown> | null => env;
export function set_kit_public_env(v: Record<string, unknown> | null) {
	env = v;
}
