---
'@ogygia/compiler': patch
---

A component marked as a region is one region however it is imported: `$lib/…`, a relative path, a root-absolute `/src/…` path or an app alias give one id, and a host with `<script lang="ts">` shares the same wrapper as a plain one (before, a root-absolute or aliased import made a second region, unstyled in dev, and the two hosts' wrappers overwrote each other) (#1415).
