---
'@ogygia/devtools': patch
'@ogygia/core': patch
---

A file the static host could not answer once (a 5xx, a timeout, a network blip) is weighed again by the next profiler report instead of being left out for the life of the process, and reports weighing a file at once share one fetch (#362).
