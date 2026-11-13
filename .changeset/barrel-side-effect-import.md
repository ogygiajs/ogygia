---
'@ogygia/compiler': patch
---

A barrel module with an import kept only for what loading it does (`import './theme.css'`, a polyfill, a namespace import it never exports) is no longer taken for a pure barrel, so the barrels pass keeps importing it and the CSS or polyfill still loads.
