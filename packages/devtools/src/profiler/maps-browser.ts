/**
 * The profiler's maps in the browser: none (they are the server build's; ./maps-server.ts).
 */
import type * as Server from './maps-server.ts';

export const read_profiler_maps: typeof Server.read_profiler_maps = async () => null;
