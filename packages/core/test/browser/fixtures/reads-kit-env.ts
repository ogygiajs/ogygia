// An island module that imports Kit's patched `$app/env/public`: like Kit's module, it reads the env
// once, as it first runs (compiler kit-patches.ts), and keeps what it read. Its build is
// `FIXTURE_BUILD`, as the compiler binds the reader to the build's own (`ogygia:boot/kit-env`).
import { kit_env } from '../../../src/runtime/kit-env.ts';

export const FIXTURE_BUILD = 'fixture-build';
export const env = kit_env(FIXTURE_BUILD);
