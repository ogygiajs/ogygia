---
'@ogygia/devtools': minor
---

The profiler's `/page`, `/reset`, `/replay/<id>` and `/logout` take a POST only, so a link on another site can no longer change the profiler's state; a GET answers 405 with `Allow: POST`. The documented call is the same query sent as a POST: `POST /__profiler/page?p=/slow/page&runs=6&format=json&key=<secret>`. A run page opened from another site waits for a click before it profiles.
