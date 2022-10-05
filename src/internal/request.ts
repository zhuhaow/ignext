import {RequestData} from 'next/dist/server/web/types';

declare const nextConfig: RequestData['nextConfig'];

// From https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers/
// and https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties
export function getRequestData(request: Request): RequestData {
	return {
		url: request.url,
		method: request.method,
		headers: toPlainHeaders(request.headers),
		ip: request.headers.get('CF-Connecting-IP') ?? undefined,
		geo: {
			country: request.cf?.country,
			city: request.cf?.city,
			region: request.cf?.region,
			latitude: request.cf?.latitude,
			longitude: request.cf?.longitude,
		},
		nextConfig,
		// Should no longer be needed
		page: undefined,
		body: request.body,
	};
}

function toPlainHeaders(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {};

	for (const [value, key] of headers.entries()) {
		result[key] = value;
	}

	return result;
}
