---
'@ogygia/core': patch
---

An `og.$` factory whose code holds `</script` or `<!--` no longer breaks the page in a build: the script that registers the factories keeps it inside its tag.
