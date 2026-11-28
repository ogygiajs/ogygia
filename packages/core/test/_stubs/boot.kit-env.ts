// Test stub for `ogygia:boot/kit-env` (the real one binds the runtime's reader to the build's own
// identity, as here to the test server stub's).
import { kit_env as read, serve_kit_env as serve } from '../../src/runtime/kit-env.ts';
import { FIXTURE_BUILD } from './server.kit-env.ts';

/** Where this stub's app serves its `env.js`: test/browser/fixtures/kit-app/env.js. */
export const serve_kit_env = (load: (url: string) => Promise<unknown>): Promise<void> =>
	serve({ base: '/test/browser/fixtures', app_dir: 'kit-app', assets: '' }, load);

export const kit_env = (): Record<string, unknown> => read(FIXTURE_BUILD);
