/**
 * THE IMAGE TYPE BYTES START LIKE: one sniffer for every raster ogygia reads from bytes it did not
 * make (a remote host's answer, a card's image), so what `remoteImage()` takes and what a card takes
 * cannot drift apart.
 *
 * @packageDocumentation
 */

/** A raster type {@link image_type} names. */
export type SniffedType =
	| 'image/png'
	| 'image/jpeg'
	| 'image/gif'
	| 'image/webp'
	| 'image/avif'
	| 'image/heif'
	| 'image/tiff';

function starts(bytes: Uint8Array, at: number, text: string): boolean {
	for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
	return true;
}

/** The type `bytes` start like: PNG, JPEG, GIF, WebP, AVIF (an ISO media file of an AVIF brand),
 *  HEIF (any other ISO media file) or TIFF; null for anything else. */
export function image_type(bytes: Uint8Array): SniffedType | null {
	if (starts(bytes, 0, '\x89PNG\r\n\x1a\n')) return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (starts(bytes, 0, 'GIF87a') || starts(bytes, 0, 'GIF89a')) return 'image/gif';
	if (starts(bytes, 0, 'RIFF') && starts(bytes, 8, 'WEBP')) return 'image/webp';
	if (starts(bytes, 4, 'ftypavif') || starts(bytes, 4, 'ftypavis')) return 'image/avif';
	if (starts(bytes, 4, 'ftyp')) return 'image/heif';
	if (starts(bytes, 0, 'II*\0') || starts(bytes, 0, 'MM\0*')) return 'image/tiff';
	return null;
}
