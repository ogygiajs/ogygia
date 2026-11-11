---
'@ogygia/content': minor
---

breaking: frontmatter `tags: [svelte]` is now a one-item list (`['svelte']`), as YAML reads a flow sequence; it used to be the string `'[svelte]'`. A value that should stay a bracketed string (`title: [create your own]`) needs quotes: `title: '[create your own]'`. A value that only starts with brackets (`[docs](/docs)`) stays text.
