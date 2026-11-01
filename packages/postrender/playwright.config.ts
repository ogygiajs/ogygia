// @ogygia/postrender's e2e suite: the scenario deck over a real build of the postrender fixture app
// (e2e/app) behind the edge emulators, its dev leg, and the handle-order checks. The specs build and
// boot the app themselves. `pnpm turbo run e2e --filter=@ogygia/postrender`.
import { fileURLToPath } from 'node:url';
import { suite } from '@ogygia/tooling/e2e/config.ts';

export default suite({ port: 3073, build: fileURLToPath(new URL('./e2e/app', import.meta.url)) });
