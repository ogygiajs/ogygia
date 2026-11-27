// An island module that imports Kit's patched `$app/env/public`: like Kit's module, it reads the env
// once, as it first runs (compiler kit-patches.ts), and keeps what it read.
import { kit_env } from '../../../src/runtime/kit-env.ts';

export const env = kit_env();
