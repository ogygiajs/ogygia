---
'@ogygia/core': patch
---

In dev, an island whose hydrate renders a different number of lakes than its server HTML had says so (`rule_lake_restored`) instead of dropping a lake's content silently.
