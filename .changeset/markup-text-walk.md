---
'@ogygia/content': patch
'@ogygia/cli': patch
---

Text taken from markup keeps the words the browser shows: the site search index no longer drops prose between a `<` and a later `>` (`a < b and c > d`), indexes no script or style text, and keeps inline code words; the MCP profile tool quotes an HTML error page by its words, not its CSS or script.
