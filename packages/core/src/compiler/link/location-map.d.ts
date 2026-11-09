/** The fixed-name map's file, in the app dir (beside Kit's `version.json`). */
export declare const CURRENT_LOCATIONS_FILE = "ogygia.json";
/**
 * Both maps, as output files: the content-hashed one first. `pairs`: identity file → hashed file,
 * output-relative. Empty when there is nothing to map.
 */
export declare function location_map_files(app_dir: string, pairs: Iterable<readonly [string, string]>, hash: (source: string) => string): {
    fileName: string;
    source: string;
}[];
