---
"@ogygia/compiler": patch
---

A client build no longer names its client chunks by bundler order: before any module loads, it follows each island's imports through package imports, so a package module both a page and an island import always reads the `$app/*` shims an island needs. Two builds of the same source write the same client files for every import the build can read up front (static imports and `import()` of a literal string, comments and type-only imports left out); a build made with `OGYGIA_RULES=1` stops with `island_graph_late` on a module that reads `$app/*` and is reached only another way. On a csr=true page such a shared module now always goes through the shim, which hands back Kit's real page state there.
