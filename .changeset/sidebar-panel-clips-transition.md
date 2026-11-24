---
'@ogygia/content': patch
---

A sidebar in a scrolled panel no longer paints its scrolled-out rows over the page during a navigation's view transition: the themes make the sidebar's panel (its parent) a view-transition layer (`og-sidebar-panel`) that holds the sidebar and chip layers and clips them to its box, in browsers with nested view-transition groups (Chromium today).
