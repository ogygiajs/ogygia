---
'@ogygia/compiler': minor
'@ogygia/core': minor
'ogygia': patch
'@ogygia/barrels': patch
'@ogygia/cli': patch
'@ogygia/content': patch
'@ogygia/devtools': patch
'@ogygia/federation': patch
'@ogygia/flags': patch
'@ogygia/postrender': patch
'@ogygia/router': patch
---

- `@ogygia/compiler`: new package, ogygia's compiler and its Vite plugin: `@ogygia/compiler` (the compiler), `@ogygia/compiler/vite` (`ogygia()`, `definePlugin`) and `@ogygia/compiler/ids`. It uses core only through `@ogygia/core/contract`; core never depends on it.
- `@ogygia/core`: breaking: the `@ogygia/core/vite`, `@ogygia/core/internal/compiler` and `@ogygia/core/internal/compiler-ids` import paths are gone. Import from `ogygia/vite` (or `@ogygia/compiler/vite`), `@ogygia/compiler` and `@ogygia/compiler/ids` instead; the names are the same.
- `@ogygia/core`: the types of the `ogygia:*` virtual modules and the build's switches are named in core (`@ogygia/core/contract`), so core's own types no longer reach into the compiler.
- `ogygia`: `ogygia/vite`, `ogygia/internal/compiler` and `ogygia/internal/compiler-ids` re-export `@ogygia/compiler`; apps change nothing.
- `@ogygia/barrels`, `@ogygia/cli`, `@ogygia/content`, `@ogygia/devtools`, `@ogygia/federation`, `@ogygia/flags`, `@ogygia/postrender`, `@ogygia/router`: they take `definePlugin` and the compiler from `@ogygia/compiler`, a new peer dependency (`ogygia` brings it).
