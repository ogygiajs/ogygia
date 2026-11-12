---
'@ogygia/core': patch
---

core: a plugin's `app.sign`, `app.verify` and `app.capability` sign in the plugin's own domain (its name, length-prefixed), so nothing a plugin signs checks as a region link or as another plugin's, dotted names included; plugin capability links minted before the upgrade are refused once and fall back like any refused hole
