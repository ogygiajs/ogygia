export type { PageSnapshot } from './page-store.svelte.ts';
export declare const page: {
    readonly url: URL;
    readonly params: Record<string, string>;
    readonly route: {
        id: string | null;
    };
    readonly status: number;
    readonly data: Record<string, unknown>;
    readonly form: {} | null;
    readonly error: {
        message: string;
    } | null;
    readonly state: Record<string, unknown>;
};
export declare const navigating: {
    readonly current: {} | null;
};
export declare const updated: {
    readonly current: boolean;
    check: () => Promise<boolean>;
};
