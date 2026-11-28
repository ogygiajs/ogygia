// An island module that imports Kit's patched `$app/env/public`: like Kit's module, it reads the env
// once, as it first runs (compiler kit-patches.ts), and keeps what it read. Its build is the test
// server stub's, as the compiler binds the reader to the build's own (`ogygia:boot/kit-env`).
import { kit_env } from '../../../src/runtime/kit-env.ts';
import { FIXTURE_BUILD } from '../../_stubs/server.kit-env.ts';

export const env = kit_env(FIXTURE_BUILD);
