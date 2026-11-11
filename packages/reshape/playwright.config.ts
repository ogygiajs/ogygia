// @ogygia/reshape's e2e suite (e2e/*.spec.ts) against the restore lab (e2e/app), built and served
// once for the specs. `pnpm turbo run e2e --filter=@ogygia/reshape`.
import { fileURLToPath } from 'node:url';
import { suite } from '@ogygia/tooling/e2e/config.ts';

export default suite({
	port: 3095,
	serve: fileURLToPath(new URL('./e2e/app', import.meta.url)),
	ready: '/restore-lab'
});
