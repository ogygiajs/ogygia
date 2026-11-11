// Test stub for `ogygia:boot` (see realm-server.ts). The modules that import the runtime back
// (hydrate-features: the runtime's own features, whose wire reads `decoders` from here) come last,
// so every plain value is evaluated when the runtime reads it.
export { FRAMES } from 'virtual:ogygia/runtime-flags';
export { region_names } from 'virtual:ogygia/devtools-meta';
export { transport, encoders, decoders } from 'virtual:ogygia/transport';
export { wire_loaders, wire_all } from 'virtual:ogygia/transportables';
export { install as install_hydrate_features } from 'virtual:ogygia/hydrate-features';
