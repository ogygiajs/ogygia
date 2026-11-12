// The `ogygia:region` module and its entries' own ids. GENERATED from the virtual-module
// table (packages/compiler/src/compiler/virtual/core.ts) by
// `node packages/compiler/scripts/virtual-types.ts`; every type is core's contract
// (src/contract/virtual-modules.ts). Do not edit.

declare module 'ogygia:region' {
export const kit_transport: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/kit-transport']['transport'];
export const transport: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/transport']['transport'];
export const encoders: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/transport']['encoders'];
export const decoders: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/transport']['decoders'];
export const wire_loaders: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/transportables']['wire_loaders'];
export const wire_all: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/transportables']['wire_all'];
}
declare module 'ogygia:region/kit-transport' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/kit-transport'];
export = module;
}
declare module 'ogygia:region/transport' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/transport'];
export = module;
}
declare module 'ogygia:region/transportables' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/transportables'];
export = module;
}
declare module 'ogygia:region/transportables-eager' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:region/transportables-eager'];
export = module;
}
