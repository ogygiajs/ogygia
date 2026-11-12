// THE SIMULATOR'S REAL-BROWSER TIER on the palaestra's build: the simulator's plans played in a
// real browser (the player: @ogygia/tooling/e2e/sim-replay.ts; internal/notes/dst.md).
//
//   SIM_PLANS=<plan.json>[,<plan.json>...] npx playwright test e2e/sim-replay --project chromium
//
// Skipped without SIM_PLANS. A plan for another app than the palaestra is skipped too.
import { sim_replay } from '@ogygia/tooling/e2e/sim-replay.ts';
import { fileURLToPath } from 'node:url';

sim_replay(fileURLToPath(new URL('..', import.meta.url)));
