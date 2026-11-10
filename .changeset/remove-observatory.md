---
'@ogygia/core': major
'ogygia': major
'@ogygia/cli': major
'@ogygia/content': patch
---

- `@ogygia/core`, `ogygia`: the internal `internal/compiler-browser` and `internal/compiler-browser-full` import paths are gone. The compiler runs in Node only.
- `@ogygia/cli`: the `ogygia mcp` server no longer has the `ogygia_observatory` tool; the Observatory it linked to is gone.
- `@ogygia/content`: its macros and markdown pipeline read the compiler through `@ogygia/core/internal/compiler` and Node's own `fs`, `path` and `crypto`.
