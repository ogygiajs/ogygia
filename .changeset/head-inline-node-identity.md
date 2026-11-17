---
'@ogygia/core': patch
---

A client navigation now puts the next page's own inline `<style>` or inline `<script>` in the head when it differs from the last page's only after its first 48 characters; before, the last page's node was kept, so the page could show with the wrong styles.
