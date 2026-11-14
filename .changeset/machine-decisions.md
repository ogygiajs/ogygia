---
'@ogygia/machine': minor
---

New `decisions()`: a pure decision table whose inputs each take a listed set of values, so its whole input space can be walked. `decide()` throws on a combination `refuse` names (`machine_decision_refused`), and in dev on a value outside its list (`machine_decision_outside`). The test-only entry `@ogygia/machine/testing` walks a table: `rows`, `check` (named rules, each broken one named with its first row), `table` (markdown), `dead_fields` and `count`, with a 100,000-row guard (`machine_decisions_too_many`) and seeded sampling.
