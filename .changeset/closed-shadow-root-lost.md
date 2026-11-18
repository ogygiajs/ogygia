---
'@ogygia/core': patch
---

In dev, a new element the router or a region update copies in that loses its closed declarative shadow root (`<template shadowrootmode="closed">`) now warns with `closed_shadow_root_lost` and the ways around it, instead of losing the root without a word.
