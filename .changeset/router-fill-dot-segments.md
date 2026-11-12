---
'@ogygia/router': patch
---

`api()`, `href()` and `entries()` throw on a param of `.` or `..` that fills a whole path segment, instead of building a URL that names another route (`/users/[id]/delete` with `id: '..'` asked `/delete`).
