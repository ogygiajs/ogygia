---
'@ogygia/core': patch
---

The router keeps the app's own `history.state` on the entries it takes over (the one it starts on, an app's own `pushState` met on Back or Forward, one replaced in place): its id goes beside that state instead of over it (#375).
