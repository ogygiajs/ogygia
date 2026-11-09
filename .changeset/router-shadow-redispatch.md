---
'@ogygia/core': patch
---

A link component that clicks its inner `<a>` again after the visitor's click no longer turns the router's navigation into a full load when that second click never reaches the document (a click event that stays in its shadow root, or an anchor the swap took out of the page): it joins the navigation the first click started (#263).
