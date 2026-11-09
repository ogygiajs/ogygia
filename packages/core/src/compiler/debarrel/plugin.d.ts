import { type Plugin } from 'vite';
import { type DebarrelOptions } from './options.ts';
import { is_script_request } from '../script-request.ts';
/** (re-exported for the tests: the check itself is shared with the island transform) */
export { is_script_request };
export interface DebarrelInternal {
    /** Import-attribute keys that mark an import as ogygia's: such an import is never rewritten. */
    skip_attribute_keys?: string[];
    /** Local bindings of a file that carry an island identity without an attribute (ogygia:
     *  `import.meta.og.asRegion(X)`): a declaration binding one of them is never rewritten, so
     *  the id the compiler's prescan derives from the raw source is the id the transform sees. */
    skip_locals?: (code: string) => ReadonlySet<string>;
}
export declare function debarrel(options?: DebarrelOptions | true, internal?: DebarrelInternal): Plugin;
/** The build-time report: totals, time spent in the pass, and the barrels by names moved — the
 *  `limit` biggest and a count of the rest (`Infinity` for every one). */
export declare function format_report(r: ReturnType<typeof debarrel_report_shape>, root: string, limit: number): string;
/** The report record's shape (for `format_report`'s signature — the value lives in the closure). */
interface DebarrelReport {
    files: number;
    importers: number;
    imports: number;
    names: number;
    first_ms: number;
    last_ms: number;
    barrels: Map<string, {
        names: number;
        importers: Set<string>;
    }>;
    skipped: Set<string> | undefined;
}
declare function debarrel_report_shape(): DebarrelReport;
