export declare const MODULE_MAP_FILE = "ogygia-modules.json";
/** chunk file (relative to the output dir) → [first line, last line, module id relative to root] */
export type ModuleMap = {
    v: 1;
    chunks: Record<string, [number, number, string][]>;
};
export declare function build_module_map(bundle: Record<string, unknown>, root: string): ModuleMap;
export declare function write_module_map(dir: string, bundle: Record<string, unknown>, root: string): void;
