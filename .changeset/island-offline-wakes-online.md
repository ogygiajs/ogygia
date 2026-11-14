---
'@ogygia/core': patch
---

An island whose code failed to load during a short outage wakes once the connection is back. It used to look up the build map first, and if the connection came back during that lookup, the island ended as failed until the page reloaded.
