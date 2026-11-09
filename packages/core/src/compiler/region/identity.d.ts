/**
 * Fingerprint of a region mark for dedupe. Same component path + same key → one wrapper/entry.
 * @param mark
 */
export declare function strategyKey(mark: {
    strategy: string;
    options?: Record<string, unknown> | null;
}): string;
/**
 * Cross-host stable identity: posix component path + {@link strategyKey}.
 * Drives region ids so multiple hosts / import sites / `<A />` usages share one module.
 */
export declare function regionIdentity(componentRelPath: string, mark: {
    strategy: string;
    options?: Record<string, unknown> | null;
}): string;
/**
 * A server-rendered region's RENDER identity: what the islands endpoint renders — the component
 * alone (posix path, `#export` for a named one). A region id names a WRAPPER (the component ⊕ its
 * page-side schedule ⊕ the build's salt); the endpoint's render of a component is the same under
 * every schedule, so a capability that names its render identity is answered by any build that
 * still serves the component as a region, whatever its schedule, its preset or the build's salt.
 * Unsalted: it is never a file name (nothing to enumerate) and only rides inside a signed URL.
 * @param identityOrPath a {@link regionIdentity} (its component half is taken) or a component path
 */
export declare function renderId(identityOrPath: string): string;
/** Hash an identity string (optional production salt) → 12-char region id. */
export declare function regionId(identityKey: string, salt?: string): string;
