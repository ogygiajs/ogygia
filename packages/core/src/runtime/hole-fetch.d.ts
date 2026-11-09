export type HoleFetch = {
    /** Past the browser cache: the endpoint may answer `private, max-age`, and stale is the whole
     *  point of revalidating. */
    revalidate?: boolean;
    priority?: 'high' | 'auto' | 'low';
    signal?: AbortSignal;
    /** A renewal answered this fresh capability for the hole. */
    renewed?: (fresh: string) => void;
};
export declare function fetch_hole(endpoint: string, opts?: HoleFetch): Promise<string>;
