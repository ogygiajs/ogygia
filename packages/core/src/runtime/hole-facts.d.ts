export type HoleFacts = {
    /** The signed capability URL the server minted. */
    endpoint: string;
    /** A hydrating hole's props sidecar, rebuilt from the recorded HTML; `null` for a static hole. */
    sidecar: HTMLScriptElement | null;
};
/** The server-minted facts of the hole with this identity on `doc`, or `null`. */
export declare function hole_facts_of(doc: Document, identity: string): HoleFacts | null;
