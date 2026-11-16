---
'@ogygia/federation': patch
---

A peer page mounted in a shell keeps the context its page set (`createContext`'s setter, ogygia's `setContext`): it reaches the peer's own islands, scoped to the mounted page.
