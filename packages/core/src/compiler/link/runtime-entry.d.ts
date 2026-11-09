/**
 * Runtime feature catalog — maps build-time marks → installable plugins.
 * Module paths are absolute file URLs resolved by the Vite plugin against dist/src.
 */
export type RuntimeMarks = {
    /** When false/undefined, emit kitchen-sink (safe default). */
    complete?: boolean;
    hydrate?: string[];
    defer?: string[];
    persist?: boolean;
    persistKeys?: string[];
    router?: boolean;
    live?: boolean;
    morph?: boolean;
    lakes?: boolean;
    forms?: boolean;
    wire?: boolean;
    remoteSeeds?: boolean;
    /** App imports an ogygia context provider (`Provide` / `setContext` / `createContext`). Set by the
     *  driver's import scan; gates the cross-island context bridge (~4.7 kB) out of apps that never
     *  provide context. Read-only providers (`getContext`) don't set it — there's nothing to bridge. */
    context?: boolean;
    /** Island code can reach Kit's page world: `$app/state` / `$app/stores` / `$app/navigation`
     *  (anything under `$app/` but `environment` and `paths`), or code the driver's island-closure walk
     *  cannot follow (a package, an unresolvable import), or a client plugin / federation that hands
     *  the runtime islands the walk never saw. Gates the page seed and the MPA navigation handle. */
    page?: boolean;
};
export type FeatureId = 'remote-seeds' | 'page' | 'wire' | 'wire-classes' | 'frames' | 'lakes' | 'morph' | 'live' | 'interaction' | 'forms' | 'mpa-nav' | 'router' | 'context';
/**
 * WHICH CHUNK a feature lives in. The runtime ships as two static, feature-sized phases:
 *
 * - `boot` — the runtime entry (`og-runtime.*.js`), loaded by the `<script>` in `<head>`. Defines
 *   `<ogygia-region>`, schedules wakes, fetches holes, morphs, routes. It must never reach Svelte:
 *   in a real app Svelte's client runtime is ONE shared chunk (~200 KB), and anything in the boot's
 *   static graph downloads first, ahead of the page's own LCP image, before any island needs it.
 * - `hydrate` — the hydrate core (`runtime/hydrate-core.js`), loaded by the runtime's single existing
 *   `import()` when the first island wakes, together with Svelte (which `hydrate()` needs anyway). A
 *   feature whose slot only the hydrate core reads belongs here, installed as the chunk evaluates.
 *
 * Both phases are generated from the same marks, so each is exactly as big as the app needs; no
 * feature adds a dynamic import of its own. `test/runtime-boot-svelte-free.test.ts` pins the boot.
 */
export type FeaturePhase = 'boot' | 'hydrate';
export type FeatureDef = {
    /** Path relative to `runtime/` (no leading ./). */
    module: string;
    deps: FeatureId[];
    detect: (m: RuntimeMarks) => boolean;
    /** Default `boot`. See {@link FeaturePhase}. */
    phase?: FeaturePhase;
};
export declare const FEATURES: Record<FeatureId, FeatureDef>;
export declare const FEATURE_ORDER: FeatureId[];
/** Resolve the closed feature set for a marks manifest. */
export declare function resolveFeatures(marks: RuntimeMarks): FeatureId[];
/** The selected features of one {@link FeaturePhase}, in FEATURE_ORDER. */
export declare function phaseFeatures(marks: RuntimeMarks, phase: FeaturePhase): FeatureId[];
/**
 * Emit the BOOT entry: core + the selected boot-phase features (see {@link FeaturePhase}).
 * @param runtimeDir Absolute directory containing `core.js` + the feature modules.
 */
export declare function generateRuntimeEntrySource(marks: RuntimeMarks, runtimeDir: string, 
/** the plugins' browser halves (`<plugin>/client` specifiers), in plugin order */
clientPlugins?: readonly string[]): {
    code: string;
    features: FeatureId[];
};
/**
 * Emit the HYDRATE-phase feature module (`virtual:ogygia/hydrate-features`), which the hydrate core
 * imports statically and installs as its chunk evaluates — so these features ride the hydrate core's
 * one existing `import()`, sized by the same marks as the boot. `all` (dev / no marks): every one.
 * @param runtimeDir Absolute directory containing the feature modules.
 */
export declare function generateHydrateFeaturesSource(marks: RuntimeMarks, runtimeDir: string, all?: boolean): {
    code: string;
    features: FeatureId[];
};
/**
 * Emit `virtual:ogygia/runtime-flags`: build-time constants for code that lives INSIDE the always-on
 * region element rather than in a feature module, because it works on the element's own state. The
 * bundler inlines an imported `const` and drops the branches it switches off, so the code a flag
 * guards ships exactly when the feature it serves does. Same marks as the entries; `all` (dev / no
 * marks): every flag on.
 *
 * - `FRAMES`: the `frames` feature is in the build — some region streams HTML (a deferred hole, a
 *   live region, a lake). Without the frame store a region's fetch has nowhere to land, so the
 *   element's fetch / apply / morph / renew path is dead code then.
 */
export declare function generateRuntimeFlagsSource(marks: RuntimeMarks, all?: boolean): string;
