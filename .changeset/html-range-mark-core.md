---
'@ogygia/core': patch
---

A template element beside an `{@html}` that a third-party script edits before the island wakes is now put back from the server markup, instead of the island throwing its hydration away; server HTML now carries a small `<!--@html-->` marker at the start of such `{@html}` content.
