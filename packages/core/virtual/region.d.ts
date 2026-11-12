// The `ogygia:region` module and its entries' own ids. GENERATED from the virtual-module
// table (packages/core/src/compiler/virtual/core.ts) by
// `node packages/core/scripts/virtual-types.ts`; every type is read off the code (see
// src/compiler/virtual/types.ts). Do not edit.

declare module 'ogygia:region' {
export const kit_transport: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_transport>['transport'];
export const transport: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').transport>['transport'];
export const encoders: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').transport>['encoders'];
export const decoders: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').transport>['decoders'];
export const wire_loaders: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').transportables>['wire_loaders'];
export const wire_all: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').transportables>['wire_all'];
}
declare module 'ogygia:region/kit-transport' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_transport>;
export = module;
}
declare module 'ogygia:region/transport' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').transport>;
export = module;
}
declare module 'ogygia:region/transportables' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').transportables>;
export = module;
}
declare module 'ogygia:region/transportables-eager' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').transportables_eager>;
export = module;
}
