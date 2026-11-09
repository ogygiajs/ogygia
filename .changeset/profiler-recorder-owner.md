---
'@ogygia/devtools': patch
---

The profiler's recorder has one owner: a recording that a reset, a second stop or another profiler outlived no longer frees the next one's lock or switches off its spans, call stacks, network log or kept answers, a reset clears the background window too, and a window past its cap that fails leaves no unhandled rejection (#196).
