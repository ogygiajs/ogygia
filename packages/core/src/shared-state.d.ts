export declare class SharedState<T extends object> {
    #private;
    constructor(name: string, initial: T);
    /** The value — reactive wherever Svelte is watching, plain everywhere else. */
    get current(): T;
    set current(v: T);
}
