# @ogygia/barrels

Barrel imports become leaf imports at transform time, for [ogygia](https://ogygiajs.dev) apps. `import { Button } from '$lib/components'` (an `index.ts` that re-exports forty files) becomes `import Button from '…/components/Button.svelte'`, so the dev module graph and the build's chunk graph hold only the leaves a file uses.

```ts
// vite.config.ts
import { ogygia } from 'ogygia/vite';
import { barrels } from '@ogygia/barrels';

export default defineConfig({
	plugins: [ogygia(), barrels(), sveltekit()]
});
```

Options: `packages`, `force`, `keep`, `importers`, `followPackages`, `report`, `debug`. Imports that carry a region (a `with { wake }` mark, or a binding `asRegion` reads) are never rewritten. See the [API reference](https://ogygiajs.dev/docs/reference/api#barrels).
