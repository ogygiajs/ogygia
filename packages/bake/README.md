# @ogygia/bake

`import.meta.og.bake(fn)` for [ogygia](https://ogygiajs.dev) apps: run a function at build time, serialize its result, and inline it as a constant. At run time there is no function and no work left, only the answer, even in client code.

```ts
// vite.config.ts
import { ogygia } from 'ogygia/vite';
import { bake } from '@ogygia/bake';

export default defineConfig({
	plugins: [ogygia(), bake(), sveltekit()]
});
```

```ts
// src/app.d.ts
/// <reference types="ogygia/types" />
/// <reference types="@ogygia/bake/types" />
```

```ts
import { buildNav } from './nav';

const nav = import.meta.og.bake(() => buildNav());
// becomes, at build: const nav = { items: [ … ] };
```

`fn` may use the module's imports and literals, and `await`, but not the module's other local variables. Its result must be serializable by [devalue](https://github.com/Rich-Harris/devalue). Imports that only fed a baked function are dropped. Without `bake()` listed, a call fails the build with `macro_needs_plugin`. See the [docs](https://ogygiajs.dev/docs/macros/bake).
