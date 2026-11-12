// The simulator's plans played in a real browser on the generated app (the player:
// @ogygia/tooling/e2e/sim-replay.ts). A plan of another generated app than the one on disk is
// skipped, and so is every plan while the app has a peer.
import { sim_replay } from '@ogygia/tooling/e2e/sim-replay.ts';
import { fileURLToPath } from 'node:url';

sim_replay(fileURLToPath(new URL('..', import.meta.url)));
