---
'@ogygia/core': patch
---

A new dev and e2e rule, `rule_transition_name_unique`: two rendered elements on a page with one inline `view-transition-name` (two `<Img morph>` of one source, say) are reported with a code, since the browser then skips the whole view transition without a word. The rule runs in browsers without `checkVisibility` too (Safari before 17.4).
