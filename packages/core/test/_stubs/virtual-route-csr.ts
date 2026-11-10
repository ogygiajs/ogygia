// Test stub for `virtual:ogygia/route-csr` — empty sets (no csr=true routes in unit tests). A suite
// that renders a csr=true document adds its route id to `csrTrueRoutes` (and deletes it after); a
// suite that renders an ERROR page under a csr=false page adds the id to `errorCsrTrueRoutes`
// instead (Kit hydrates that error page from the layouts' csr). `rootLayoutCsrTrue` is the
// routeless answer (no route matched → the root layout's csr).
export const csrTrueRoutes = new Set<string>();
export const errorCsrTrueRoutes = new Set<string>();
export const rootLayoutCsrTrue = false;
