type ClientHooksModule = {
    init?: (input?: unknown) => unknown;
};
export declare function run_app_client_hooks(loader: () => Promise<ClientHooksModule>): void;
export {};
