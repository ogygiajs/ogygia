---
'@ogygia/core': minor
---

`createContext`'s old callable form is removed: no `theme('dark')` `<Provide>` entry, no `theme.get()`, no `theme.key` and no default argument. Destructure `const [getTheme, setTheme, hasTheme] = createContext<Theme>('theme')`, call the setter above, and ask `hasTheme()` where you used a default.
