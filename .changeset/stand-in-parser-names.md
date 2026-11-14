---
'@ogygia/rewrite': patch
---

A stand-in tag whose attributes include a name only the HTML parser accepts (like `=eq`) is restored to its real tag, and the restore goes on to every stand-in and host after it instead of stopping with an error.
