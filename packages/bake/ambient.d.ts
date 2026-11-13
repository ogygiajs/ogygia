// `@ogygia/bake/types` — `import.meta.og.bake` (merged into core's `ImportMetaOg` from
// `ogygia/types`). Reference both from the app's `src/app.d.ts`:
//
//   /// <reference types="ogygia/types" />
//   /// <reference types="@ogygia/bake/types" />
//
// A compile construct: the `bake()` plugin rewrites each call at transform time.
interface ImportMetaOg {
	/**
	 * Run `fn` at BUILD, serialize its result, and inline it as a constant — "run at build, ship
	 * the answer." `fn` may use this module's IMPORTS and literals and `await` freely, but must be
	 * self-contained (no closing over the module's other locals). Its result must be
	 * devalue-serializable (JSON + Date/Map/Set/RegExp/BigInt) — a function, Promise, or class
	 * instance in the result is a build error. At runtime there is no function and no work, even in
	 * client code. Needs `bake()` from `@ogygia/bake` beside `ogygia()`.
	 */
	bake<T>(fn: () => T | Promise<T>): T;
}
