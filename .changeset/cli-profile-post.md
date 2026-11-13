---
'@ogygia/cli': patch
---

The CLI's perf measure and the MCP profile tool ask the profiler's `/page` and `/reset` with a POST, as those routes now take a POST only.
