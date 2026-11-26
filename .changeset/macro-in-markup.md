---
'@ogygia/compiler': patch
---

A plugin macro call that its plugin does not compile now fails the build with `macro_in_markup` instead of reaching the page and throwing there: a call in a component's template expression, in a markdown page's (`.svx`, `.md`) prose expression (`{…}`), or in a markdown page's `<script>` for a macro that does not compile there. A markdown page's prose expression without the plugin listed fails with `macro_needs_plugin`, like a script call.
