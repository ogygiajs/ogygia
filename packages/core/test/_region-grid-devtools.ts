// Imported first by the region grid's server leg: devtools on, as an app built with them, before the
// server's event registry reads its gate (once, when it loads). Region reads its own gate per render,
// so a render can still turn it off (region-grid-fuzz.test.ts › "with devtools off").
(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
export {};
