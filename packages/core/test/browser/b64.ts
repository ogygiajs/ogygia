/** The text a global setup handed over as base64 of its UTF-8 bytes. */
export function from_b64(b64: string): string {
	return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}
