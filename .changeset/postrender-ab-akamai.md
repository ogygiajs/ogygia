---
"@ogygia/core": minor
"@ogygia/flags": minor
"@ogygia/postrender": minor
---

Support variant-keyed caching for A/B-tested pages and regions without edge poisoning, align `AkamaiEdge` with Akamai flushing rules (`DELETE` by default, colon-free `Edge-Cache-Tag` tokens, tag purges, structural tag priority, and optional `variants` edge-keying), add `EdgeOneEdge` for Tencent Cloud EdgeOne (`TC3-HMAC-SHA256`), and add `postrender.invalidateTags(tags)`.
