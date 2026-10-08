import { WorkerEntrypoint } from 'cloudflare:workers';
import { fileType } from './filetype.mjs';
import { getExtensionFromRequest } from './extension';
import { EXTENSION_MIME_TYPES } from './mime-types';

const hasValidHeader = (request: Request, env: Env) => {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader) return false;
	const secrets = env.ACCESS_KEYS.split(',').map((x) => `Bearer ${x}`);
	return secrets.includes(authHeader);
};

const INIITAL_FILENAME_LENGTH = 5;
const TRIES_PER_LENGTH = 3;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DEFAULT_HEADERS: [key: string, value: string][] = [['access-control-allow-origin', '*']];

function getRandomString(length: number) {
	let result = '';
	for (let i = 0; i < length; i += 1) {
		result += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	}
	return result;
}

async function getRandomFileName(env: Env, ext: string) {
	let length = INIITAL_FILENAME_LENGTH;
	while (true) {
		for (let i = 0; i < TRIES_PER_LENGTH; i += 1) {
			const candidate = `${getRandomString(length)}${ext}`;
			if (!(await env.FILES.head(candidate))) {
				return candidate;
			}
		}
		length += 1;
	}
}

function response(body?: BodyInit | null, init?: ResponseInit): Response {
	return new Response(body, {
		...init,
		headers: [
			...DEFAULT_HEADERS,
			...(init?.headers
				? init.headers instanceof Headers
					? init.headers
					: Symbol.iterator in init.headers
						? [...init.headers].map((header) => [...header])
						: Object.entries(init.headers)
				: []),
		],
	});
}

export default class extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		switch (url.pathname) {
			case '/files': {
				switch (request.method) {
					case 'OPTIONS': {
						return response(null, {
							headers: [
								['allow', 'PUT'],
								['access-control-allow-methods', 'PUT'],
								['access-control-allow-headers', 'authorization,content-type,x-requested-with'],
							],
						});
					}
					case 'PUT': {
						if (!hasValidHeader(request, this.env)) {
							return response('You are not authorized', { status: 401 });
						}
						if (!request.body) {
							return response('No file to upload', { status: 400 });
						}
						let ext = '';
						const headers = new Headers(request.headers);
						const [body, mimetypeStream] = request.body.tee();
						const reader = mimetypeStream.getReader({ mode: 'byob' });
						const buffer = new ArrayBuffer(8192);
						const view = new DataView(buffer);
						const { value } = await reader.read(view);
						reader.releaseLock();
						if (value) {
							const filetype = fileType(new Uint8Array(value.buffer));
							const mime = filetype?.[1] ?? 'application/octet-stream';
							if (!headers.has('content-type')) {
								headers.set('content-type', mime);
							}
							const detectedExt = filetype?.[0];
							if (detectedExt) {
								ext = `.${detectedExt}`;
							}
						}
						// Fall back to extension from the request (?filename= or ?ext=) when content sniffing fails
						const extension = getExtensionFromRequest(url);
						if (extension) {
							if (!ext) ext = `.${extension}`;
							const extMime = EXTENSION_MIME_TYPES[extension];
							if (extMime && (!request.headers.has('content-type') || headers.get('content-type') === 'application/octet-stream')) {
								headers.set('content-type', extMime);
							}
						}
						let key = await getRandomFileName(this.env, ext);
						await mimetypeStream.cancel();
						try {
							await this.env.FILES.put(key, body, {
								onlyIf: headers,
								httpMetadata: headers,
							});
						} catch {
							return response('Error uploading file', { status: 500 });
						}
						return response(`https://files.sillie.st/${key}`, {
							headers: [['content-type', 'text/plain']],
						});
					}
				}
			}
		}
		return response('Invalid request', { status: 400 });
	}
}
