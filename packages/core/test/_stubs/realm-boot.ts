// Test stub for `ogygia:boot` (see realm-server.ts). The modules that import the runtime back
// (hydrate-features: the runtime's own features) come last, so every plain value is evaluated when
// the runtime reads it.
export { FRAMES, load_wire_codec } from 'ogygia:boot/runtime-flags';
export { region_names } from 'ogygia:boot/devtools-meta';
export { install as install_hydrate_features } from 'ogygia:boot/hydrate-features';
