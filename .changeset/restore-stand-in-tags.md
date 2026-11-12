---
'@ogygia/reshape': patch
---

`@ogygia/reshape`: the restorer for an app's server transform turns an `<og-as>` stand-in back only into a tag the server pass writes as one (a block, a list or table part, a link, a button, a form, an option), and never copies an `on*` attribute onto it. Any other `<og-as>` is left as it is.
