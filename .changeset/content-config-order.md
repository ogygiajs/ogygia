---
'@ogygia/content': patch
---

`content({ markdown })` now says `content_config_read_first` when the svelte config was loaded before it and so read no markdown settings, instead of leaving every markdown file uncompiled with no message.
