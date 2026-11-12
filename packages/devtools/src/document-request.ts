/** A browser asking for a page as a document (not a router's fetch of it, nor a script's). */
export function is_document_request(request: Request): boolean {
	const dest = request.headers.get('sec-fetch-dest');
	return dest ? dest === 'document' : (request.headers.get('accept') ?? '').includes('text/html');
}
