---
'@ogygia/machine': minor
---

`flights()` carries a priority: `get(input, { priority })` raises a flight in progress to the highest priority of the callers that joined it (never lowers it), and the run reads `flight.priority` and hears each raise through `flight.onRaise()`.
