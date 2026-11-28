# @ogygia/postrender

Kit's prerender, at request time, for [ogygia](https://ogygiajs.dev). A page whose render read nothing personal is stored whole on its first request, and later visitors get the stored bytes until an invalidation clears them. Pages that read bounded `@ogygia/flags` variants store one copy per arm combination behind a decision trie without poisoning shared caches. Kit, your loads and Svelte never run on a hit, and `render: 'deferred'` holes inside a stored page stay per visitor.

## Install

```bash
pnpm add @ogygia/postrender @ogygia/data-shake
```

```ts
// vite.config.ts
import { ogygia } from 'ogygia/vite';
import { postrender } from '@ogygia/postrender/vite';
import { dataShake } from '@ogygia/data-shake/vite';

export default defineConfig({
	plugins: [ogygia(), postrender({ ttl: 86400 }), dataShake(), sveltekit()]
});
```

```ts
// src/hooks.server.ts — postrender's handle goes BEFORE ogygia's
import { sequence } from '@sveltejs/kit/hooks';
import * as ogygia from 'ogygia/server';
import { postrender, ValkeyStore, AkamaiEdge, EdgeOneEdge } from '@ogygia/postrender';

export const handle = sequence(
	postrender.handle({
		store: new ValkeyStore(client),
		edge: [new AkamaiEdge(akamaiCreds), new EdgeOneEdge(edgeOneCreds)]
	}),
	ogygia.handle()
);
```

With no `store`, pages are kept in an in-process LRU. Built-in stores: `MemoryStore`, `ValkeyStore`, `UpstashStore`, `CloudflareKvStore`. Built-in CDN edges: `AkamaiEdge` (Fast Purge v3 `DELETE` + `Edge-Cache-Tag`), `EdgeOneEdge` (Tencent Cloud EdgeOne `TC3-HMAC-SHA256` `CreatePurgeTask`), `CloudflareEdge`, `CloudFrontEdge`.

## Use

A route opts out in Kit's own `config` (layouts merge into pages, the page's key wins):

```ts
// src/routes/account/+page.ts
export const config = { postrender: false };
```

`postrender({ default: false })` makes it opt-in: a page or layout then sets `config = { postrender: true }`.

```ts
// a CMS or flag webhook endpoint
await postrender.invalidate('/blog/hello/');                    // one URL
await postrender.invalidateWhere({ prefix: '/blog/' });         // a subtree
await postrender.invalidate(loadDoc, ['promo']);                // declared og.source
await postrender.invalidateTags(['site_cms_fr', 'site_top20']); // external cache tags
```

Docs: [@ogygia/postrender](https://ogygiajs.dev/docs/postrender/overview), with the full [Postrender](https://ogygiajs.dev/docs/postrender/guide) guide.
