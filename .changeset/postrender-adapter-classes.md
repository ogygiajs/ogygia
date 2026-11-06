---
'@ogygia/postrender': minor
---

Postrender's stores and edges are classes: `new MemoryStore()`, `new ValkeyStore(client)`, `new UpstashStore({ url, token })`, `new CloudflareKvStore(binding)`, `new AkamaiEdge(cfg)`, `new CloudFrontEdge(cfg)` and `new CloudflareEdge(cfg)` replace `memoryStore()`, `valkey()`, `upstash()`, `cloudflareKv()`, `akamai()`, `cloudfront()` / `awsCloudfront()` and `cloudflare()` (same arguments).
