---
"ogygia": patch
---

**Breaking (plugin API):** a plugin's per-route setting is now a key inside Kit's own `config` page option — `b.routeConfig(key)` / `ctx.routeConfig(key)` replace `b.routeOption(name)` / `ctx.routeOption(name)`, nothing is stripped from route files any more, and the server router's `page()` / `layout()` / `routes()` take `config` instead of `freeze`.
