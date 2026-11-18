---
'@ogygia/compiler': patch
---

In dev, a route option file (such as a `+page.ts` with `csr`) saved by an editor that empties the file before writing it is now read again once the write lands. Before, the dev server could keep the empty read, and a page kept the wrong csr until the next save or a restart.
