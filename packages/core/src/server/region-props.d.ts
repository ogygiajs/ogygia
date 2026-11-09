/** Ensure the island-prop kinds are registered (called per encode; Map.has-cheap). */
export declare function ensure_prop_kinds(): void;
/**
 * @returns b64url payload, or null when props cannot cross the wire (non-devalue or oversized).
 */
export declare function encode_region_props(props: Record<string, unknown>): string | null;
