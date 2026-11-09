---
'@ogygia/devtools': patch
---

Stopping a session recording a second time no longer ends the recording started after it, nor takes back its console patch: a recording's stop runs once and touches only its own run (#240).
