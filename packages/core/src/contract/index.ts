/**
 * `@ogygia/core/contract`: what core and the compiler (`@ogygia/compiler`) share, and the compiler's
 * only way into core. Node-only: the compiler runs at build time.
 *
 * @packageDocumentation
 * @internal
 */
export * from './barrels.ts';
export * from './capability.ts';
export * from './content.ts';
export * from './core-files.ts';
export type * from './events.ts';
export * from './hash.ts';
export * from './hydration-hazards.ts';
export * from './messages.ts';
export * from './own-package.ts';
export * from './prose.ts';
export * from './runtime-hooks.ts';
export * from './trigger.ts';
export * from './unscoped-css.ts';
export type * from './virtual-modules.ts';
/** The region endpoint's defaults the dev server and the build agree on. */
export { DEFAULT_REGION_TTL_SEC } from '../server/endpoint.ts';
/** The markers the compiler stamps and core reads, from the page markup's vocabulary (#479). */
export { OG_HTML, OG_OPAQUE } from '../wire-markup.ts';
/** The app secret's checks and the id salt derived from it. */
export { derive_id_salt, secret_has_min_entropy, MIN_SECRET_BYTES } from '../server/hmac.ts';
