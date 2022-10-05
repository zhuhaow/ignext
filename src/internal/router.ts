// The implementation depends deciphering the source code
// of Next.js instead of following its document as there is none.
// Should expect breakage during Next.js version change.

import {RequestData} from 'next/dist/server/web/types';
import {getRequestData} from './request';

// eslint-disable-next-line @typescript-eslint/naming-convention
declare const _ENTRIES: Record<
	string,
	{
		default: (parameters: {
			request: RequestData;
		}) => Promise<{response: Response; waitUntil: Promise<any>}>;
	}
>;

interface Route {
	page: string;
	regex: string;
	routeKeys: Record<string, string>;
	namedRegex: string;
}

declare const routesManifest: {
	dynamicRoutes: Route[];
};

export const onRequest: PagesFunction = async ({
	request,
	waitUntil,
	env: {ASSETS},
}) => {
	// For now we only support serve static then dynamic with no basepath or locale.
	// https://nextjs.org/docs/advanced-features/middleware#matching-paths is the full route order we need to handle

	const assetsResponse = await ASSETS.fetch(request);
	if (assetsResponse.ok) {
		return assetsResponse;
	}

	const url = new URL(request.url);

	for (const route of routesManifest.dynamicRoutes) {
		if (new RegExp(route.regex).test(url.pathname)) {
			// eslint-disable-next-line no-await-in-loop
			const {response, waitUntil: promise} = await _ENTRIES[
				`middleware_${route.page}`
			].default({request: getRequestData(request)});

			waitUntil(promise);

			return response;
		}
	}

	const notFoundResponse = await ASSETS.fetch(
		new URL('/404', request.url).toString(),
	);

	return new Response(notFoundResponse.body, {
		...notFoundResponse,
		status: 404,
		statusText: 'Not found',
	});
};
