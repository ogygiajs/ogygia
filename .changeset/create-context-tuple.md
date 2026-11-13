---
'@ogygia/core': minor
---

`createContext<T>(name)` from `ogygia` now returns Svelte's `[get, set, has]` shape, keyed by `Symbol.for(name)` so the value reaches every region in the browser (`const [getRuntime, setRuntime] = createContext<AppRuntime>('app-runtime')`); the old callable form (`theme('dark')`, `theme.get()`, a default) still works and is deprecated.
