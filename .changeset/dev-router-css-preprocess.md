---
'@ogygia/compiler': patch
---

In dev, a server-router page component's CSS is compiled as the build compiles it: `<style lang="scss">` and `<script lang="ts">` are preprocessed first, so its styles are scoped in dev as they are in production (#1422).
