// @ogygia/postrender's e2e suite: the scenario deck over a real build of the postrender fixture app
// (e2e/app) behind the edge emulators, its dev leg, and the handle-order checks. The specs build and
// boot the app themselves. `pnpm turbo run e2e --filter=@ogygia/postrender`.
import { fileURLToPath } from 'node:url';
import { suite } from '@ogygia/tooling/e2e/config.ts';

// adapter-node 6 (Kit 3) takes the origin at BUILD time: the build (globalSetup, which inherits this
// env) bakes in the scenario deck's origin (e2e/postrender.spec.ts), whose POSTs pass Kit's
// same-origin check only when the build knows it serves plain http there
process.env.ORIGIN ??= 'http://127.0.0.1:3073';

export default suite({ port: 3073, build: fileURLToPath(new URL('./e2e/app', import.meta.url)) });
