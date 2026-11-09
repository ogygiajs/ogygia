import { type LakeArm, type LiftedLake } from './slots.ts';
/** Feature entry: fill the `lakes` slot so core lifts/restores frozen regions. */
export declare function install(): void;
export declare function settle_in(root: ParentNode): void;
export declare function lift(parent: Element): LiftedLake[];
export declare function restore(parent: Element, lifted: LiftedLake[]): void;
export declare function on_frozen_connect(el: HTMLElement, arm: LakeArm): boolean;
export declare function wait_for_boundary(_el: HTMLElement, boundary: Element | null): boolean;
export declare function mark_frozen_settled(region: HTMLElement): void;
export declare function after_html_swap(region: HTMLElement, opts: {
    revalidate?: boolean;
}, wake_children: () => void): void;
export declare function after_fetch_exhausted(region: HTMLElement, opts: {
    revalidate?: boolean;
}, wake_children: () => void): void;
