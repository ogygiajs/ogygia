---
'@ogygia/federation': minor
---

`@ogygia/federation`: **Breaking:** an app checks the signed calls it receives against its `audience`, or the host of its `ORIGIN` environment variable when it sets none, and never against the `Host` the request names. With neither, every signed call gets a 401 and `federate()` warns `federation_audience_missing`; set `audience` (or `ORIGIN`) on each app that peers call into. `verify_signed_request()` without `audience` follows the same rule.
