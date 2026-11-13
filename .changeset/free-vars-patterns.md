---
'@ogygia/compiler': patch
---

A portable snippet now carries the names its pattern defaults read (`{#each xs as { a = dflt }}`, a snippet parameter's default, `{@const}`, `{#await … then}`), its `{@debug}` names, and a name read after a `catch` clause that bound the same name; each was missed and threw a ReferenceError on the far side, or left the snippet native.
