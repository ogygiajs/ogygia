---
'@ogygia/content': patch
---

A `<` in markdown prose that cannot start a tag (`if it is < 512KB`, `I <3 it`) is text, as CommonMark reads it: the page shows it instead of failing the build with Svelte's `tag_invalid_name`. A `<` before a letter, `/`, `!` or `?` is left as written, so an inline component (`A <Badge count={n + 1}/> here`) stays a component, and a `<` inside a `{…}` expression is left to Svelte. A remark or rehype plugin that puts a `<` that cannot start a tag into a text node now gets that character as text.
