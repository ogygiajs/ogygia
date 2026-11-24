import * as ogygia from 'ogygia/server';

// The SSR profiler (dev only) is configured in vite.config.ts and mounted inside ogygia.handle().
export const handle = ogygia.handle();
