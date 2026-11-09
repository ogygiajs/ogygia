---
'@ogygia/machine': patch
---

A stage that committed or was discarded leaves nothing on its owner, so a long-lived owner of many stages no longer grows (#345).
