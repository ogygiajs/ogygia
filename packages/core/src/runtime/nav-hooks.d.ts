/** Tie a registration's unsubscribe to the calling component's lifetime; returns it too. */
export declare function bind_to_component(off: () => void): () => void;
