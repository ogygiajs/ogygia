# @ogygia/page-keys

Seed shaping for [ogygia](https://ogygiajs.dev) apps. An island that reads `page.data` through `$app/state` or `$app/stores` gets the page's data in its seed. Without this plugin that seed is all of `page.data`. With it, the build reads each module for the top-level `page.data` keys it can reach, and the page ships only the keys its islands read. A server hole whose code reads none skips the lookup.

```ts
// vite.config.ts
import { ogygia } from 'ogygia/vite';
import { pageKeys } from '@ogygia/page-keys';

export default defineConfig({
	plugins: [ogygia(), pageKeys(), sveltekit()]
});
```

A read the analysis cannot pin to a literal key (`page.data` spread, passed whole to a function it cannot follow, indexed with a variable) gives that region all of `page.data`, as without the plugin. The build's seed report names the line. See the [API reference](https://ogygiajs.dev/docs/reference/api#pagekeys).
