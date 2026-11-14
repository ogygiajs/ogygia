---
'@ogygia/core': patch
'@ogygia/compiler': patch
---

An island from a mounted peer page now reads the cross-island context its page provides (`<Provide>`, `setContext`, `createContext`), even when the shell provides no context of its own. Before, a production shell left the context bridge out and never handed context to a peer's island, so the island hydrated with its context silently empty. A federated build now also ships the live-region feature a peer's held or kept regions need.
