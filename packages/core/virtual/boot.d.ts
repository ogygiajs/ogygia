// The `ogygia:boot` module and its entries' own ids. GENERATED from the virtual-module
// table (packages/core/src/compiler/virtual/core.ts) by
// `node packages/core/scripts/virtual-types.ts`; every type is read off the code (see
// src/compiler/virtual/types.ts). Do not edit.

declare module 'ogygia:boot' {
export const region_names: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').devtools_meta>['region_names'];
export const install_hydrate_features: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').hydrate_features>['install'];
export const FRAMES: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').runtime_flags>['FRAMES'];
}
declare module 'ogygia:boot/devtools-meta' {
export const region_names: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').devtools_meta>['region_names'];
}
declare module 'ogygia:boot/fn-manifest' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').fn_manifest>;
export = module;
}
declare module 'ogygia:boot/hydrate-features' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').hydrate_features>;
export = module;
}
declare module 'ogygia:boot/runtime' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').runtime>;
export = module;
}
declare module 'ogygia:boot/runtime-entry' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').runtime_entry>;
export = module;
}
declare module 'ogygia:boot/runtime-flags' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').runtime_flags>;
export = module;
}
