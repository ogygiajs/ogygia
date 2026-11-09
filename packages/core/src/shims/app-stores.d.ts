import { type Unsubscriber } from 'svelte/store';
import { type PageSnapshot } from './page-store.svelte.ts';
declare function snapshot(): PageSnapshot;
type Snapshot = ReturnType<typeof snapshot>;
export declare const page: {
    subscribe(run: (value: Snapshot) => void): () => void;
};
export declare const navigating: {
    subscribe(run: (value: unknown) => void): Unsubscriber;
};
export declare const updated: {
    subscribe(run: (value: boolean) => void): () => void;
    check: () => Promise<boolean>;
};
/** Kit's `getStores()` (Kit 3 removed it; an island importing it still builds, and reads these). */
export declare const getStores: () => {
    page: typeof page;
    navigating: typeof navigating;
    updated: typeof updated;
};
export {};
