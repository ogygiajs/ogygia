---
'@ogygia/core': minor
'ogygia': minor
'@ogygia/cli': minor
'@ogygia/content': patch
---

- `@ogygia/core`, `ogygia`: breaking: the internal `internal/compiler-browser` and `internal/compiler-browser-full` import paths are gone. The compiler runs in Node only; use `@ogygia/core/internal/compiler` there.
- `@ogygia/cli`: breaking: the `ogygia mcp` server no longer has the `ogygia_observatory` tool; the Observatory it linked to is gone.
- `@ogygia/content`: its macros and markdown pipeline read the compiler through `@ogygia/core/internal/compiler` and Node's own `fs`, `path` and `crypto`.
