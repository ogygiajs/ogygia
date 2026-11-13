---
'@ogygia/devtools': patch
---

The profiler's standalone HTML export sends the profiler secret only with the report page's own fetch, never with the stylesheets and chunks it inlines (which may be on another host, such as a CDN).
