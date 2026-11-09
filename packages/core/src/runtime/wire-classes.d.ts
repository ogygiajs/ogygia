/** Feature entry: fill the `wire_classes` slot. */
export declare function install(): void;
/** The loads this island's props, context and page seeds need, or `null` when none (the common
 *  case: an app without transportables, or an island that carries none). */
export declare function wire_classes_for(region: Element): Promise<unknown> | null;
