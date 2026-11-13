# @ogygia/rewrite

An app's own pass over the HTML [ogygia](https://ogygiajs.dev) sends: a web-component server render, a translation proxy, a tool that edits markup. The pass may move Svelte's markup; ogygia marks the HTML before it, records what it moved after it, and puts it back in the browser before anything hydrates. Apps without such a pass don't install this package and ship none of it.

## Install

```bash
pnpm add @ogygia/rewrite
```

```ts
// vite.config.ts
import { ogygia } from 'ogygia/vite';
import { reshape } from '@ogygia/rewrite/vite';

export default defineConfig({
	plugins: [ogygia(), reshape(), sveltekit()]
});
```

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import * as ogygia from 'ogygia/server';
import * as reshape from '@ogygia/rewrite';

export const handle = sequence(
	reshape.handle((html, { kind, csr, event }) => render(html)),
	ogygia.handle()
);
```

A transform written in a module of its own takes the `ReshapeTransform` type:

```ts
import type { ReshapeTransform } from '@ogygia/rewrite';

export const render: ReshapeTransform = (html, { kind }) =>
	renderComponents(html, { fragment: kind === 'region' });
```

## Markup helpers

`scanRegions`, `liftRegions`, `restoreRegions`, `transformMarkup`, `localizeMarks`, `checkScript` and `restore` come from `@ogygia/rewrite` too. They need no Kit, so they run in a test or in the non-SvelteKit half of a monorepo.

Docs: [Server transforms](https://ogygiajs.dev/docs/app/server-transforms).
