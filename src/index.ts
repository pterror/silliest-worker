import { WorkerEntrypoint } from 'cloudflare:workers';

const hasValidHeader = (request: Request, env: Env) => {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader) return false;
	const secrets = env.AUTH_KEY_SECRET.split(',').map((x) => `Bearer ${x}`);
	return secrets.includes(authHeader);
};

const INIITAL_FILENAME_LENGTH = 5;
const TRIES_PER_LENGTH = 3;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const getRandomString = (length: number) => {
	let result = '';
	for (let i = 0; i < length; i += 1) {
		result += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	}
	return result;
};

const getRandomFileName = async (env: Env) => {
	let length = INIITAL_FILENAME_LENGTH;
	while (true) {
		for (let i = 0; i < TRIES_PER_LENGTH; i += 1) {
			const candidate = getRandomString(length);
			if (!(await env.FILES.head(candidate))) {
				return candidate;
			}
		}
		length += 1;
	}
};

export default class extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		switch (url.pathname) {
			case '/files': {
				switch (request.method) {
					case 'PUT': {
						if (!hasValidHeader(request, this.env)) {
							return new Response('You are not authorized', { status: 401 });
						}
						const key = url.searchParams.get('fileName') || (await getRandomFileName(this.env));
						try {
							await this.env.FILES.put(key, request.body, {
								onlyIf: request.headers,
								httpMetadata: request.headers,
							});
						} catch {
							return new Response('Error uploading file', { status: 500 });
						}
						return new Response(`Put ${key} successfully!`);
					}
				}
			}
		}
		return new Response('Invalid request', { status: 400 });
	}
}
