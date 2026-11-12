import * as ogygia from 'ogygia/server';

// The SSR profiler is configured in vite.config.ts (`devtools({ profiler: true })`) and mounted inside
// ogygia.handle() — not wired here. Without OGYGIA_PROFILER_SECRET the UI hides itself in
// production, so it's inert on deploys.
export const handle = ogygia.handle();
