---
'@ogygia/core': patch
---

In dev and rules builds, the hydration scheduler's count of waiting islands is checked against the islands it holds (`rule_turns_counted`), so a drift is said instead of leaving islands waiting.
