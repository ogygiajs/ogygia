/**
 * Is this module id a request for the module's SCRIPT? The query decides. vite-plugin-svelte serves
 * a component's extracted CSS as `Foo.svelte?svelte&type=style&lang.css`, and Vite's `?raw`, `?url`,
 * `?inline`, `?worker` are not the module's code either. Passes that strip the query before an
 * extension test took those for the component: the barrel rewrite ran the Svelte parser over plain
 * CSS, threw, and reported every component with a `<style>` as skipped (3,233 false warnings in one
 * production build, burying the real ones). A cache query (`?v=123`, `?t=…`) or ogygia's own
 * (`?og-region`) is still the script. String scanning, no regex: it runs for every module.
 */
export declare function is_script_request(id: string): boolean;
