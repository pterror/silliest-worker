/** Reads ?ext= or the ?filename= suffix; returns '' if neither is present. */
export function getExtensionFromRequest(url: URL): string {
	const name = url.searchParams.get('filename') ?? '';
	return (url.searchParams.get('ext') ?? name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? '').toLowerCase();
}
