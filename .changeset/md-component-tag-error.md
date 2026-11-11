---
'@ogygia/content': minor
---

breaking: `import.meta.og.md()` with a component tag in its prose (`<Foo />`, `<ui.Button />`) is now the build error `content_md_dynamic`; it used to render the tag as an inert unknown element. Use a component for the live part, or put the tag in inline code or a fence to show it as text.
