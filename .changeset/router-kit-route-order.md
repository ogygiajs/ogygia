---
'@ogygia/router': minor
---

`@ogygia/router`: **Breaking:** when route patterns overlap, a path now resolves to the route SvelteKit would pick for the same files (an `[[optional]]` that is not last counts for nothing, so `/[[lang]]/docs` ranks as `/docs`; `/b` beats `/b/[[page]]`; ties go by route id, never table order), and `CompiledPattern` no longer has a `score` field.
