// Test stub for `virtual:ogygia/route-csr` — empty sets (no csr=true routes in unit tests). A suite
// that renders a csr=true document adds its route id to `csr_true_routes` (and deletes it after); a
// suite that renders an ERROR page under a csr=false page adds the id to `error_csr_true_routes`
// instead (Kit hydrates that error page from the layouts' csr). `root_layout_csr_true` is the
// routeless answer (no route matched → the root layout's csr). The module's value is the default
// export; the sets are exported by name too, for the suites that change them.
export const csr_true_routes = new Set<string>();
export const error_csr_true_routes = new Set<string>();
export default { csr_true_routes, error_csr_true_routes, root_layout_csr_true: false };
