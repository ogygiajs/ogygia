---
'@ogygia/core': patch
---

The islands endpoint answers on its one path under the app's base, the path every capability is minted for: with `handle({ endpoint: '/api' })`, a page at `/docs/api` is a page again, not taken for a hole render. A second `handle()` naming another endpoint in one production server is now said (`islands_endpoint_conflict`) instead of silently replacing the first.
