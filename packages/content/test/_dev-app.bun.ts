// The dev edit scenario (#247) under Bun: `bun test/_dev-app.bun.ts` prints, for each way Kit loads a
// server module in dev, what two page edits left behind (as one JSON line). dev-reload.test.ts runs
// it when Bun is installed.
import { LOADERS, two_page_edits } from './_dev-app.ts';

const out: Record<string, unknown> = {};
for (const [name, load] of LOADERS) out[name] = await two_page_edits(load);
console.log(JSON.stringify(out));
process.exit(0);
