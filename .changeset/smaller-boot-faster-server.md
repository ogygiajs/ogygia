---
'ogygia': minor
'@ogygia/core': minor
'@ogygia/compiler': minor
---

A smaller boot and a faster server: the compiler now builds each page's runtime with only the features its regions use, so a static page's boot is about 28% smaller (brotli), a plain server's output about 25% smaller, server requests do about half the work, plain servers answer about 20% more requests a second, and router navigations are about 30% faster.
