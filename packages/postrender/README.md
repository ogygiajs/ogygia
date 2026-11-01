# @ogygia/postrender

Kit's prerender, at request time, for [ogygia](https://ogygia.puruvj.dev). A page whose render read nothing personal is stored whole on its first request, and later visitors get the stored bytes until an invalidation clears them. Kit, your loads and Svelte never run on a hit. `render: 'deferred'` holes inside a stored page stay per visitor.

## Install

```bash
pnpm add @ogygia/postrender
```

```ts
// vite.config.ts
import { ogygia } from 'ogygia/vite';
import { postrender } from '@ogygia/postrender/vite';

export default defineConfig({
	plugins: [ogygia(), postrender({ ttl: 86400 }), sveltekit()]
});
```

```ts
// src/hooks.server.ts — postrender's handle goes BEFORE ogygia's
import { sequence } from '@sveltejs/kit/hooks';
import * as ogygia from 'ogygia/server';
import { postrender, valkey } from '@ogygia/postrender';

export const handle = sequence(postrender.handle({ store: valkey(client) }), ogygia.handle());
```

With no `store`, pages are kept in an in-process LRU.

## Use

A route opts out in Kit's own `config` (layouts merge into pages, the page's key wins):

```ts
// src/routes/account/+page.ts
export const config = { postrender: false };
```

`postrender({ default: false })` makes it opt-in: a page or layout then sets `config = { postrender: true }`.

```ts
// a CMS webhook endpoint
await postrender.invalidate('/blog/hello/');            // one URL
await postrender.invalidateWhere({ prefix: '/blog/' }); // a subtree
```

Docs: [Postrender](https://ogygia.puruvj.dev/docs/data-state/postrender).
