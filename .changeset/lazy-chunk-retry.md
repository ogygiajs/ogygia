---
'@ogygia/core': patch
---

A lazy runtime chunk (the hydrate core, devalue, the interaction replay) that fails to download is asked for again under a fresh URL, so one dropped request no longer leaves every later island wake in the tab dead (#201).
