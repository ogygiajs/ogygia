/**
 * `@ogygia/devtools/internal/messages`: every code's table, for the docs' `ogygiajs.dev/e` pages. The
 * package's own code imports ./build.ts (the Vite plugin) or ./runtime.ts (the profiler's server
 * half), never this module.
 *
 * @packageDocumentation
 * @internal
 */
export { DEVTOOLS_BUILD_ERRORS, DEVTOOLS_BUILD_WARNINGS } from './build.ts';
export { DEVTOOLS_ERRORS, DEVTOOLS_WARNINGS } from './runtime.ts';
