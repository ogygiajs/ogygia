---
'@ogygia/machine': patch
---

`@ogygia/machine`: Faster hot reads on `cache()` and `registry()`: a `get` of the value set or read last no longer moves or looks it up again (a kept `flights` answer read by every island takes about half the steps), a cache with no `onEvict` queues no notices, observers are walked from one array kept until they change (`registry().snapshot()`), and `registry.keyed()` walks its definitions without a generator.
