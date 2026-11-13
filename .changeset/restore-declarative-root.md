---
'@ogygia/reshape': patch
---

A restored host's shadow root is now declarative, as a server-rendered `<template shadowrootmode>` root would be: a component whose constructor attaches its own root no longer throws on upgrade, and gets that root back emptied. A host not yet upgraded is replaced by an equal element during the restore, before anything hydrates.
