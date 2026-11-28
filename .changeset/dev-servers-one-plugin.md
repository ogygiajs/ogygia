---
'@ogygia/compiler': patch
---

One ogygia plugin serving two open dev servers at once (a restart that opens the new server before the old one closes, or two servers made with one plugin list) now updates both: an edit to a route's options, a style or an island's imports, and a deleted island's page reload, reach every open server, not only the first to hear it; closing one server leaves the other serving, and a second ogygia() on the same root never touches the first one's servers.
