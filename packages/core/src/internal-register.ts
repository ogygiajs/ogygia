/**
 * The Region-free slice of `ogygia/internal` that the compiler's INJECTED imports reference — the
 * appended-registration helpers (`__register_transportable` per exported class, `__tag_context` per
 * `createContext`) and the macro runtime (`__og_$` / `__og_store` / `__og_boundary`, emitted by the
 * `import.meta.og.$` / `.store` passes). The transform drops an import of these into app modules, so
 * this module is dragged into whatever realm those modules run in.
 *
 * It exists to keep those injections Region-free. The `ogygia/internal` barrel they target also
 * re-exports {@link ./Region.svelte} (which reaches `$app/paths` → Kit's client runtime → `window`).
 * A bundled client build tree-shakes `Region` away when only these helpers are used, but Vite DEV
 * serves raw ESM with no tree-shaking, so the barrel eagerly evaluates `Region.svelte`. Every re-export
 * below sits on a pure transport/context/boundary leaf that reaches neither `Region` nor `$app/*`, so
 * importing this seam is safe in every realm.
 */
export { __register_transportable } from './live-transport.ts';
export { __tag_context } from './context-bridge.ts';
// The server-router CSS registry — imported by the GENERATED `ogygia:server/router-css` (never by
// user code). Region-free leaf (a WeakMap module), so it keeps this seam safe in every realm.
export { register_router_css, register_router_css_paths } from './router-css.ts';
export { __og_$ } from './fn-transport.ts';
export { __og_store } from './store-transport.ts';
export { __og_boundary } from './boundary.ts';
