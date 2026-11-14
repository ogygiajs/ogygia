# @ogygia/jumpstart

A server build in a few files for [ogygia](https://ogygiajs.dev) apps, so a cold start reads a few files instead of hundreds.

```ts
// vite.config.ts
import { ogygia } from 'ogygia/vite';
import { jumpstart } from '@ogygia/jumpstart';

export default defineConfig({
	plugins: [ogygia(), jumpstart({ external: ['sharp'] }), sveltekit()]
});
```

A SvelteKit server build puts nearly every module in its own small file, and leaves dependencies in `node_modules`, where Node loads them one file at a time. On a slow serverless box that per-file cost is most of a cold start. `jumpstart()` changes the server build only:

- Every dependency is bundled in (Vite's `noExternal`), except the packages listed in `external`.
- The framework (Svelte, Kit, ogygia) and every dependency go in one chunk, `server`.
- Each region registry, a `.ts` or `.js` module that marks region imports (a block registry), gets a chunk of its own, `regions-<name>`, with the blocks it renders. Only a page that imports the registry loads it, so a page with no blocks starts as fast as before.
- App code that a registry shares with the rest of the app goes in `regions-shared`, so a page outside the registry never loads the registry.

The client build and dev are not touched, and pages are served byte for byte as without it. At the end of each build, one line names every package that stayed outside the server bundle and why (`jumpstart_external`).

`external` lists the packages that cannot be bundled, by package name: one with a native addon, one that reads files next to its own module (`new URL('./data.wasm', import.meta.url)`, `__dirname`), or one that must be a single instance across the process. A package listed there is imported from `node_modules` at run time, so the deploy needs it installed.

`adapter-node` and `adapter-vercel` keep the chunks as built. An adapter that bundles the server again with its own tool may merge them. See the [API reference](https://ogygiajs.dev/docs/reference/api#jumpstart).
