export interface SigningKey {
    secret: string;
    /** the app's or the env's: survives redeploys and is shared by every deployment that sets the same value */
    stable: boolean;
    /** 8-char key fingerprint (`&k=` on capabilities, `x-ogygia-key` on refusals) */
    fp: string;
    /** where the secret came from: `handle({ secret })`, `OGYGIA_SECRET`, or this build's random key */
    source: 'option' | 'env' | 'build';
}
export declare function signing_key(): SigningKey;
/**
 * Record the app's `handle({ secret })`. A blank one counts as none (an app can pass a value that may
 * be unset). Once a key is decided it never changes in the process: capabilities minted under the
 * first would stop verifying, so a different secret arriving later is an error (thrown in dev).
 */
export declare function configure_signing_secret(secret: string | undefined): void;
export declare function key_fingerprint(secret: string): string;
/** Tests: forget the decided key and the app's secret. */
export declare function reset_signing_key(): void;
