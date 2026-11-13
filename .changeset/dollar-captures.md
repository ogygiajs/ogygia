---
'@ogygia/compiler': patch
---

`import.meta.og.$` captures exactly what its function reads from outside: a name a block or an inner function shadows is still captured where it is not shadowed, an imported name that shares a global's name (`fetch`) is captured instead of read as the global, and a class method name or `import.meta` is no capture; a `$()` inside another `$()` fails the build.
