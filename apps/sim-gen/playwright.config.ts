// THE SIMULATOR'S REAL-BROWSER TIER on the generated app: the app on disk (written by
// `pnpm sim:gen --seed N`) built as the simulator builds it (a rules build) and served, and the
// plans of runs on it (SIM_PLANS) played in real browsers (e2e/sim-replay.spec.ts).
//
//   SIM_PLANS=<plan.json>,... pnpm --filter sim-gen sim:browser --project chromium
//
// Not an `e2e` script: the app's pages are not in git (each seed writes its own), so CI has no
// app to build here.
import { suite } from '@ogygia/tooling/e2e/config.ts';
import { fileURLToPath } from 'node:url';

export default suite({
	port: Number(process.env.PORT || 3097),
	serve: fileURLToPath(new URL('.', import.meta.url)),
	env: { OGYGIA_RULES: '1' }
});
