/** Feature entry: enable form-field survival across SPA nav (unless the build disabled it). */
export declare function install(): void;
/** Snapshot changed island fields in `root` under `pathKey`. Call BEFORE the body is swapped out. */
export declare function snapshot_forms(root: ParentNode, pathKey: string): void;
/**
 * Arm restoration for `pathKey` on the freshly-connected page. Restores already-hydrated islands
 * immediately and hooks `ogygia:hydrated` for those still waking, for this page's restore window
 * (see `restore_window`).
 */
export declare function arm_form_restore(pathKey: string): void;
