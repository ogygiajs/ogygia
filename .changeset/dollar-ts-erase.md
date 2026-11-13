---
'@ogygia/compiler': patch
---

A function marked with `import.meta.og.$` in TypeScript hoists as plain JS with optional parameters, `!` assignments, local types and interfaces, `<T>x` casts, `this` parameters and class modifiers; an enum, a namespace with values or a parameter property inside it fails the build at its line instead of breaking the page.
