import { handle } from './handle.ts';
import { invalidate, invalidateWhere } from './registry.ts';

/**
 * Pages stored at request time, on the server only. Prerender renders a page at build time;
 * postrender renders it on its first request, stores it whole, and serves the stored bytes until
 * an invalidation clears it.
 *
 * ```ts
 * // vite.config: the switch (+ serializable policy)
 * import { postrender } from '@ogygia/postrender/vite';
 * plugins: [ogygia(), postrender(), sveltekit()]
 *
 * // hooks.server.ts: the live store and CDN edges, BEFORE ogygia's handle
 * import { postrender, ValkeyStore, AkamaiEdge } from '@ogygia/postrender';
 * export const handle = sequence(
 *   postrender.handle({ store: new ValkeyStore(client), edge: [new AkamaiEdge(creds)] }),
 *   ogygia.handle()
 * );
 *
 * // a route opts out in Kit's own config: export const config = { postrender: false };
 *
 * // anywhere server-side (CMS publish webhook):
 * await postrender.invalidate('/fr/fr/solar/');            // exact URL
 * await postrender.invalidate(loadContent, [args]);        // og.source reverse index
 * await postrender.invalidateWhere({ prefix: '/fr/fr/' }); // subtree nuke
 * ```
 */
export const postrender: {
	handle: typeof handle;
	invalidate: typeof invalidate;
	invalidateWhere: typeof invalidateWhere;
} = { handle, invalidate, invalidateWhere };

export { MemoryStore } from './memory-store.ts';
export { ValkeyStore } from './adapters/valkey.ts';
export { UpstashStore } from './adapters/upstash.ts';
export { CloudflareKvStore } from './adapters/cloudflare-kv.ts';
export { AkamaiEdge } from './adapters/akamai.ts';
export { CloudFrontEdge } from './adapters/cloudfront.ts';
export { CloudflareEdge } from './adapters/cloudflare.ts';
export type {
	PostrenderEntry,
	PostrenderStore,
	PostrenderPutOptions,
	PostrenderMeta,
	EdgeAdapter,
	PostrenderHandleOptions
} from './types.ts';
export type { ValkeyLike } from './adapters/valkey.ts';
export type { UpstashConfig } from './adapters/upstash.ts';
export type { KvNamespaceLike } from './adapters/cloudflare-kv.ts';
export type { AkamaiConfig } from './adapters/akamai.ts';
export type { CloudfrontConfig } from './adapters/cloudfront.ts';
export type { CloudflareConfig } from './adapters/cloudflare.ts';
