---
'@ogygia/core': patch
---

A page with declarative shadow DOM now works after a router navigation: its web components get their shadow roots, no `<template shadowrootmode>` is left inert, and its islands hydrate instead of being discarded. A host the navigation keeps (same element at the same place on both pages) keeps its live shadow root; give it a different `id` or `data-key` on each page to take the new page's render.
