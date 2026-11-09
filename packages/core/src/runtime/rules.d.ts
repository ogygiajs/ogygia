import { Rules } from '../rules.ts';
type RuntimeRule = 'rule_region_mounted_twice' | 'rule_address_bar_drift' | 'rule_old_page_open' | 'rule_failure_uncoded' | 'rule_parse_upgraded';
/** The runtime's rules. */
export declare const runtime_rules: Rules<RuntimeRule>;
/** A region element mounted its island. */
export declare function note_mount(region: Element): void;
/** A region element let its island go. */
export declare function note_unmount(region: Element): void;
type Visit = {
    readonly scope: {
        readonly closed: boolean;
    };
};
/** A page visit was made (`current`: it is the page on screen's now). */
export declare function note_visit(visit: Visit, is_current: boolean): void;
/** What the rule reads of the router: its navigation, and its history model's page on screen. */
interface RouterView {
    readonly nav: {
        readonly now: {
            readonly kind: string;
        };
    };
    readonly history: {
        readonly current: {
            readonly id: string;
            readonly url: URL;
        };
    };
}
/** The router started: its history model is checked against the address bar. */
export declare function watch_router(router: RouterView): void;
/** Rules on: `globalThis.__ogygia_rules()` gives what is broken now (for e2e); in dev they are also
 *  checked after machine moves, and what broke is said with its code. */
export declare function install_rules(dev: boolean): void;
export {};
