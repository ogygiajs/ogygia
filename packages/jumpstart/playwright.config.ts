// @ogygia/jumpstart's e2e suite: its committed fixture apps (e2e/app on Kit 2, e2e/app-kit3 on Kit 3,
// e2e/plain with no regions) built with and without jumpstart(), and the strictExecutionOrder
// canary. The specs build and serve the apps themselves. `pnpm turbo run e2e --filter=@ogygia/jumpstart`.
import { suite } from '@ogygia/tooling/e2e/config.ts';

export default suite({ port: 3127 });
