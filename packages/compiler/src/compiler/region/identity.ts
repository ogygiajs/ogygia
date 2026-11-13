import { createHash } from 'node:crypto';

const PATH_SEP = /[/\\]/;

/**
 * Fingerprint of a region mark for dedupe. Same component path + same key → one wrapper/entry.
 * Every option baked into the wrapper is in the key (a cache TTL, the stitch mode, the warm
 * schedule, a `keep` name, a margin), so two marks that differ in one never share a wrapper. A
 * held region's key starts `region:`, apart from a placed wrapper of the same schedule.
 * @param mark
 */
export function strategyKey(mark: {
	strategy: string;
	options?: Record<string, unknown> | null;
}): string {
	const o = mark.options || {};
	if (mark.strategy === 'server') {
		let k = `defer:${o.when ?? 'load'}`;
		if (o.margin != null) k = `${k}:margin:${o.margin}`;
		if (o.cacheTtlSec != null) k = `${k}:ttl:${o.cacheTtlSec}`;
		if (o.stitch) k = `${k}:stitch:${o.stitch}`;
		if (o.prefetch) k = `${k}:prefetch:${o.prefetch}`;
		if (o.hydrate) {
			k = `${k}+hydrate:${o.hydrate}`;
			if (o.hydrateMargin != null) k = `${k}:hmargin:${o.hydrateMargin}`;
		}
		return k;
	}
	if (mark.strategy === 'lake') {
		let k = `lake:${o.remount || 'cache'}`;
		if (o.when) k = `${k}:when:${o.when}`;
		if (o.maxAgeMs != null) k = `${k}:maxAge:${o.maxAgeMs}`;
		if (o.onExpire) k = `${k}:onExpire:${o.onExpire}`;
		if (o.margin != null) k = `${k}:margin:${o.margin}`;
		return k;
	}
	if (mark.strategy === 'held') {
		let k = `region:${o.hydrate || 'raw'}`;
		if (o.hydrateMargin != null) k = `${k}:hmargin:${o.hydrateMargin}`;
		return k;
	}
	let k = `hydrate:${mark.strategy}`;
	if (o.margin != null) k = `${k}:margin:${o.margin}`;
	if (o.keep != null) k = `${k}:keep:${o.keep}`;
	return k;
}

/**
 * Cross-host stable identity: posix component path + {@link strategyKey}.
 * Drives region ids so multiple hosts / import sites / `<A />` usages share one module.
 */
export function regionIdentity(
	componentRelPath: string,
	mark: { strategy: string; options?: Record<string, unknown> | null }
) {
	return `${String(componentRelPath).split(PATH_SEP).join('/')}\0${strategyKey(mark)}`;
}

/**
 * A server-rendered region's RENDER identity: what the islands endpoint renders — the component
 * alone (posix path, `#export` for a named one). A region id names a WRAPPER (the component ⊕ its
 * page-side schedule ⊕ the build's salt); the endpoint's render of a component is the same under
 * every schedule, so a capability that names its render identity is answered by any build that
 * still serves the component as a region, whatever its schedule, its preset or the build's salt.
 * Unsalted: it is never a file name (nothing to enumerate) and only rides inside a signed URL.
 * @param identityOrPath a {@link regionIdentity} (its component half is taken) or a component path
 */
export function renderId(identityOrPath: string): string {
	const nul = identityOrPath.indexOf('\0');
	const component = (nul === -1 ? identityOrPath : identityOrPath.slice(0, nul))
		.split(PATH_SEP)
		.join('/');
	return createHash('md5').update(`render\0${component}`).digest('hex').slice(0, 12);
}

/** Hash an identity string (optional production salt) → 12-char region id. */
export function regionId(identityKey: string, salt = ''): string {
	const msg = salt ? `${salt}\0${identityKey}` : identityKey;
	return createHash('md5').update(msg).digest('hex').slice(0, 12);
}
