---
'@ogygia/core': patch
---

A hole batch called off while its body is still arriving (two quick link clicks), or whose body breaks off, now ends quietly: no more "Uncaught (in promise) AbortError" for error monitors to report. Its holes still fetch on their own.
