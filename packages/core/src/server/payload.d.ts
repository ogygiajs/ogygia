export declare class B64Url {
    /** @param str utf-8 string */
    static encode(str: string): string;
    /** @param b64 base64url string (decoded only after its MAC verified) */
    static decode(b64: string): string;
}
