---
'@ogygia/cli': patch
---

`ogygia mcp` answers every request exactly once: a malformed one gets a JSON-RPC error instead of no answer (which left the client waiting).
