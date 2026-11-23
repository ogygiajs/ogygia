---
'@ogygia/content': patch
---

Sidebar labels no longer look doubled during a navigation's view transition: the sidebar is now one view-transition layer (`og-sidebar`, named on its `<nav>`) that shows its new state at once, instead of one layer per row with the old and new snapshots stacked; the active chip still glides beneath the labels (a custom skin that styled the `phnav` row layers styles `::view-transition-group(og-sidebar)` instead).
