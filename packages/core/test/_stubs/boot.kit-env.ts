// Test stub for `ogygia:boot/kit-env` (the real one binds the runtime's reader to the build's own
// identity, as here to the test server stub's).
import { kit_env as read } from '../../src/runtime/kit-env.ts';
import { FIXTURE_BUILD } from './server.kit-env.ts';

export const kit_env = (): Record<string, unknown> => read(FIXTURE_BUILD);
