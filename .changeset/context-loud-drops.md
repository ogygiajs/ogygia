---
'@ogygia/core': patch
'@ogygia/compiler': patch
---

A context that cannot cross into regions is now said, not dropped silently: a one-off `Symbol()` key (`context_key_one_off`) or a function value (`context_value_function`) set with `setContext` from `ogygia` or in a `<Provide>` warns in dev, naming the key and what to use instead; the build warns on a one-off `Symbol()` key it can see (`region_context_key_one_off`), and its "island code reads a context nothing bridges" warning now covers `Symbol.for(name)` keys.
