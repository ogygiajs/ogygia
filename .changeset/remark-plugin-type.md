---
'@ogygia/content': minor
---

The `remark` and `rehype` markdown options are typed: each entry is a plugin, a `[plugin, ...options]` tuple, a unified preset (`{ plugins, settings }`) or a staged `{ enforce, plugin }`, where they were `any` before.
