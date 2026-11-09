/** The import a flag site comes through. (Moves into the flags plugin's compile facet once the
 *  compile port lands: internal/notes/packages.md.) */
export declare const FLAGS_SPEC = "@ogygia/flags";
export interface FlagSite {
    name: string;
    kind: 'flag';
    /** root-relative (or package-relative) posix path. */
    file: string;
    line: number;
}
export declare function collect_flag_sites(code: string, id: string, file: string): FlagSite[];
/** Stable, deduped (both build legs prescan) manifest shape. */
export declare function flags_manifest(sites: readonly FlagSite[]): {
    flags: FlagSite[];
    names: string[];
};
