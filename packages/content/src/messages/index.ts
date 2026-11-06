/**
 * `@ogygia/content/internal/messages`: every code's table, for the docs' `ogygiajs.dev/e` pages. The
 * package's own code imports ./build.ts (the Vite plugin, the macros, the markdown compiler) or
 * ./runtime.ts (collections, sources, the docs site), never this module.
 *
 * @packageDocumentation
 * @internal
 */
export { CONTENT_BUILD_ERRORS, CONTENT_BUILD_WARNINGS } from './build.ts';
export { CONTENT_ERRORS, CONTENT_WARNINGS } from './runtime.ts';
