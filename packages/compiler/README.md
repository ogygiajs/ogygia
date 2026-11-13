# @ogygia/compiler

The compiler of [ogygia](https://ogygiajs.dev). It rewrites your marked imports into regions, links
the build, and holds the Vite plugin.

Published, but apps do not install it directly. They install `ogygia`, whose `ogygia/vite` is this
package's `./vite`, and whose `ogygia/internal/compiler` is this package's main entry. Plugin
packages (`@ogygia/router`, `@ogygia/content`, `@ogygia/flags`, `@ogygia/federation`,
`@ogygia/devtools`, `@ogygia/postrender`, `@ogygia/reshape`, …) and `@ogygia/cli` import it to hook
into the build.

## Entries

| import                  | what it is                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `@ogygia/compiler`      | the source-to-source engine: the region transform, `Compiler`, `Program`, `CompileCtx`. Internal |
| `@ogygia/compiler/vite` | the `ogygia()` Vite plugin, and `definePlugin()` for plugin packages                             |
| `@ogygia/compiler/ids`  | the virtual module ids and naming helpers. Safe to load in the browser                           |

Nothing here is a stable public API on its own. The public face is `ogygia/vite`.

## Use

An app lists the plugin through `ogygia`:

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [ogygia(), sveltekit()] });
```

A plugin package declares itself with `definePlugin()` (this is `@ogygia/router`'s whole plugin):

```ts
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';

export function router(): OgygiaPlugin {
	return definePlugin({
		name: '@ogygia/router',
		build(b) {
			b.pageModules({ importers: ['@ogygia/router'] });
		}
	});
}
```

The plugin API is internal and can change between releases.

## Work on it

```bash
pnpm --filter @ogygia/compiler build   # writes the virtual-module types, then tsdown
pnpm --filter @ogygia/compiler test    # vitest
pnpm --filter @ogygia/compiler check   # tsc on src and test, then vitest
```

Some tests import the built `dist/` (the plugin runs from it), so build before you test. Bench files
are in `bench/`.

More: [Writing a plugin](https://ogygiajs.dev/docs/core/plugins),
[`internal/notes/compiler-refactor.md`](../../internal/notes/compiler-refactor.md).
