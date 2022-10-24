/* eslint-disable unicorn/prefer-node-protocol */
import {ParsedUrlQuery} from 'querystring';
import {UrlWithParsedQuery} from 'url';
import {MiddlewareManifest} from 'next/dist/build/webpack/plugins/middleware-plugin';
import isError, {getProperError} from 'next/dist/lib/is-error';
import {CustomRoutes, Rewrite} from 'next/dist/lib/load-custom-routes';
import {BaseNextRequest, BaseNextResponse} from 'next/dist/server/base-http';
import BaseServer, {
	MiddlewareRoutingItem,
	NoFallbackError,
} from 'next/dist/server/base-server';
import type {NextConfigComplete} from 'next/dist/server/config-shared';
import {addRequestMeta, getRequestMeta} from 'next/dist/server/request-meta';
import Router, {DynamicRoutes, Route} from 'next/dist/server/router';
import {
	createHeaderRoute,
	createRedirectRoute,
	getCustomRoute,
} from 'next/dist/server/server-route-utils';
import {FetchEventResult, NextMiddleware} from 'next/dist/server/web/types';
import {toNodeHeaders} from 'next/dist/server/web/utils';
import {CLIENT_STATIC_FILES_RUNTIME} from 'next/dist/shared/lib/constants';
import {detectDomainLocale} from 'next/dist/shared/lib/i18n/detect-domain-locale';
import {normalizeLocalePath} from 'next/dist/shared/lib/i18n/normalize-locale-path';
import {getNextPathnameInfo} from 'next/dist/shared/lib/router/utils/get-next-pathname-info';
import getRouteFromAssetPath from 'next/dist/shared/lib/router/utils/get-route-from-asset-path';
import {isDynamicRoute} from 'next/dist/shared/lib/router/utils/is-dynamic';
import {
	getMiddlewareRouteMatcher,
	MiddlewareRouteMatch,
} from 'next/dist/shared/lib/router/utils/middleware-route-matcher';
import {ParsedUrl, parseUrl} from 'next/dist/shared/lib/router/utils/parse-url';
import {getPathMatch} from 'next/dist/shared/lib/router/utils/path-match';
import {prepareDestination} from 'next/dist/shared/lib/router/utils/prepare-destination';
import {relativizeURL} from 'next/dist/shared/lib/router/utils/relativize-url';
import {removeTrailingSlash} from 'next/dist/shared/lib/router/utils/remove-trailing-slash';
import {DecodeError} from 'next/dist/shared/lib/utils';
import {NextRequest, NextResponse} from 'next/server';
import {adapter} from 'next/dist/server/web/adapter';
import {WebNextResponse} from 'next/dist/server/base-http/web';
import {urlQueryToSearchParams} from 'next/dist/shared/lib/router/utils/querystring';
import {requestToBodyStream} from 'next/dist/server/body-streams';
import {ManifestProvider} from './manifest-provider';
import {PageChecker} from './page-checker';
import {Renderer} from './renderer';

export abstract class RouterBuilder {
	protected router!: Router;

	public getRouter(): Router {
		if (this.router) {
			return this.router;
		}

		this.router = new Router(this.build());

		return this.router;
	}

	protected abstract build(): ReturnType<BaseServer['generateRoutes']>;
}

export class IgnextRouterBuilder extends RouterBuilder {
	// eslint-disable-next-line max-params
	constructor(
		private readonly manifestProvider: ManifestProvider,
		private readonly nextConfig: NextConfigComplete,
		private readonly renderer: Renderer,
		private readonly customRoutes: CustomRoutes,
		private readonly dynamicRoutes: DynamicRoutes,
		private readonly pageChecker: PageChecker,
		private readonly loadFunction: (
			pathname: string,
		) => Promise<NextMiddleware | undefined>,
	) {
		super();
	}

	protected generatePublicRoutes(): Route[] {
		// TODO: Here we should check if the request asset exists.

		return [
			// {
			// 	match: getPathMatch('/:path*'),
			// 	matchesBasePath: true,
			// 	name: 'public folder catchall',
			// 	fn: async (request, res, parameters, parsedUrl) => {
			// 		const pathParts: string[] = parameters.path || [];
			// 		const {basePath} = this.nextConfig;
			// 		// If basePath is defined require it be present
			// 		if (basePath) {
			// 			const basePathParts = basePath.split('/');
			// 			// Remove first empty value
			// 			basePathParts.shift();
			// 			if (
			// 				!basePathParts.every((part: string, idx: number) => {
			// 					return part === pathParts[idx];
			// 				})
			// 			) {
			// 				return {finished: false};
			// 			}
			// 			pathParts.splice(0, basePathParts.length);
			// 		}
			// 		let path = `/${pathParts.join('/')}`;
			// 		if (!publicFiles.has(path)) {
			// 			// In `next-dev-server.ts`, we ensure encoded paths match
			// 			// decoded paths on the filesystem. So we need do the
			// 			// opposite here: make sure decoded paths match encoded.
			// 			path = encodeURI(path);
			// 		}
			// 		if (publicFiles.has(path)) {
			// 			await this.serveStatic(
			// 				request,
			// 				res,
			// 				join(this.publicDir, ...pathParts),
			// 				parsedUrl,
			// 			);
			// 			return {
			// 				finished: true,
			// 			};
			// 		}
			// 		return {
			// 			finished: false,
			// 		};
			// 	},
			// } as Route,
		];
	}

	protected generateImageRoutes(): Route[] {
		return [
			{
				match: getPathMatch('/_next/image'),
				type: 'route',
				name: '_next/image catchall',
				fn: async (request, response, _parameters, _parsedUrl) => {
					const imagesConfig = this.nextConfig.images;

					if (imagesConfig?.loader !== 'default') {
						await this.renderer.render404(request, response);
						return {finished: true};
					}

					// TODO: handle image process logic

					return {finished: true};
				},
			},
		];
	}

	protected generateFsStaticRoutes(): Route[] {
		return [
			{
				match: getPathMatch('/_next/static/:path*'),
				type: 'route',
				name: '_next/static catchall',
				fn: async (request, response, parameters, parsedUrl) => {
					// Make sure to 404 for /_next/static itself
					if (!parameters.path) {
						await this.renderer.render404(request, response, parsedUrl);
						return {
							finished: true,
						};
					}

					if (
						parameters.path[0] === CLIENT_STATIC_FILES_RUNTIME ||
						parameters.path[0] === 'chunks' ||
						parameters.path[0] === 'css' ||
						parameters.path[0] === 'image' ||
						parameters.path[0] === 'media' ||
						parameters.path[0] === this.manifestProvider.getBuildId() ||
						parameters.path[0] === 'pages' ||
						parameters.path[1] === 'pages'
					) {
						response.setHeader(
							'Cache-Control',
							'public, max-age=31536000, immutable',
						);
					}

					// TODO: serve assets in the following method
					// await this.serveStatic(request, response, p, parsedUrl);
					return {
						finished: true,
					};
				},
			},
		];
	}

	protected generateRewrites({
		restrictedRedirectPaths,
	}: {
		restrictedRedirectPaths: string[];
	}) {
		let beforeFiles: Route[] = [];
		let afterFiles: Route[] = [];
		let fallback: Route[] = [];

		const buildRewrite = (rewrite: Rewrite, check = true): Route => {
			const rewriteRoute = getCustomRoute({
				type: 'rewrite',
				rule: rewrite,
				restrictedRedirectPaths,
			});
			return {
				...rewriteRoute,
				check,
				type: rewriteRoute.type,
				name: `Rewrite route ${rewriteRoute.source}`,
				match: rewriteRoute.match,
				matchesBasePath: true,
				matchesLocale: true,
				// eslint-disable-next-line @typescript-eslint/naming-convention
				matchesLocaleAPIRoutes: true,
				matchesTrailingSlash: true,
				// eslint-disable-next-line unicorn/prevent-abbreviations, max-params
				async fn(request, res, parameters, parsedUrl, upgradeHead) {
					const {newUrl, parsedDestination} = prepareDestination({
						appendParamsToQuery: true,
						destination: rewriteRoute.destination,
						params: parameters,
						query: parsedUrl.query,
					});

					// External rewrite, proxy it
					if (parsedDestination.protocol) {
						throw new Error('Do not support proxy request yet.');
					}

					addRequestMeta(request, '_nextRewroteUrl', newUrl);
					addRequestMeta(request, '_nextDidRewrite', newUrl !== request.url);
					return {
						finished: false,
						pathname: newUrl,
						query: parsedDestination.query,
					};
				},
			};
		};

		if (Array.isArray(this.customRoutes.rewrites)) {
			afterFiles = this.customRoutes.rewrites.map((r) => buildRewrite(r));
		} else {
			beforeFiles = this.customRoutes.rewrites.beforeFiles.map((r) =>
				buildRewrite(r, false),
			);
			afterFiles = this.customRoutes.rewrites.afterFiles.map((r) =>
				buildRewrite(r),
			);
			fallback = this.customRoutes.rewrites.fallback.map((r) =>
				buildRewrite(r),
			);
		}

		return {
			beforeFiles,
			afterFiles,
			fallback,
		};
	}

	protected build(): ReturnType<BaseServer['generateRoutes']> {
		const publicRoutes = this.generatePublicRoutes();
		const imageRoutes = this.generateImageRoutes();

		const fsRoutes: Route[] = [
			...this.generateFsStaticRoutes(),
			{
				match: getPathMatch('/_next/data/:path*'),
				type: 'route',
				name: '_next/data catchall',
				check: true,
				// eslint-disable-next-line unicorn/prevent-abbreviations
				fn: async (request, res, parameters, _parsedUrl) => {
					// Make sure to 404 for /_next/data/ itself and
					// we also want to 404 if the buildId isn't correct
					if (
						!parameters.path ||
						parameters.path[0] !== this.manifestProvider.getBuildId()
					) {
						await this.renderer.render404(request, res, _parsedUrl);
						return {
							finished: true,
						};
					}

					// Remove buildId from URL
					// eslint-disable-next-line @typescript-eslint/no-unsafe-call
					parameters.path.shift();

					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const lastParameter = parameters.path[parameters.path.length - 1];

					// Show 404 if it doesn't end with .json
					if (
						typeof lastParameter !== 'string' ||
						!lastParameter.endsWith('.json')
					) {
						await this.renderer.render404(request, res, _parsedUrl);
						return {
							finished: true,
						};
					}

					// Re-create page's pathname
					// eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-unsafe-call
					let pathname = `/${parameters.path.join('/')}`;
					pathname = getRouteFromAssetPath(pathname, '.json');

					// Ensure trailing slash is normalized per config
					if (this.router.catchAllMiddleware[0]) {
						if (this.nextConfig.trailingSlash && !pathname.endsWith('/')) {
							pathname += '/';
						}

						if (
							!this.nextConfig.trailingSlash &&
							pathname.length > 1 &&
							pathname.endsWith('/')
						) {
							pathname = pathname.slice(0, Math.max(0, pathname.length - 1));
						}
					}

					if (this.nextConfig.i18n) {
						const {host} = request?.headers || {};
						// Remove port from host and remove port if present
						const hostname = host?.split(':')[0].toLowerCase();
						const localePathResult = normalizeLocalePath(
							pathname,
							this.nextConfig.i18n.locales,
						);
						const {defaultLocale} =
							detectDomainLocale(this.nextConfig.i18n.domains, hostname) ?? {};

						let detectedLocale = '';

						if (localePathResult.detectedLocale) {
							pathname = localePathResult.pathname;
							detectedLocale = localePathResult.detectedLocale;
						}

						_parsedUrl.query.__nextLocale = detectedLocale;
						_parsedUrl.query.__nextDefaultLocale =
							defaultLocale ?? this.nextConfig.i18n.defaultLocale;

						if (!detectedLocale && !this.router.catchAllMiddleware[0]) {
							_parsedUrl.query.__nextLocale =
								_parsedUrl.query.__nextDefaultLocale;
							await this.renderer.render404(request, res, _parsedUrl);
							return {finished: true};
						}
					}

					return {
						pathname,
						query: {..._parsedUrl.query, __nextDataReq: '1'},
						finished: false,
					};
				},
			},
			...imageRoutes,
			{
				match: getPathMatch('/_next/:path*'),
				type: 'route',
				name: '_next catchall',
				// This path is needed because `render()` does a check for `/_next` and the calls the routing again
				// eslint-disable-next-line unicorn/prevent-abbreviations
				fn: async (request, res, _parameters, parsedUrl) => {
					await this.renderer.render404(request, res, parsedUrl);
					return {
						finished: true,
					};
				},
			},
			...publicRoutes,
		];

		const restrictedRedirectPaths = this.nextConfig.basePath
			? [`${this.nextConfig.basePath}/_next`]
			: ['/_next'];

		// Headers come very first
		const headers = this.customRoutes.headers.map((rule) =>
			createHeaderRoute({rule, restrictedRedirectPaths}),
		);

		const redirects = this.customRoutes.redirects.map((rule) =>
			createRedirectRoute({rule, restrictedRedirectPaths}),
		);

		const rewrites = this.generateRewrites({restrictedRedirectPaths});
		const catchAllMiddleware = this.generateCatchAllMiddlewareRoute();

		const catchAllRoute: Route = {
			match: getPathMatch('/:path*'),
			type: 'route',
			matchesLocale: true,
			name: 'Catchall render',
			// eslint-disable-next-line unicorn/prevent-abbreviations
			fn: async (request, res, _parameters, parsedUrl) => {
				let {pathname, query} = parsedUrl;
				if (!pathname) {
					throw new Error('pathname is undefined');
				}

				// Next.js core assumes page path without trailing slash
				pathname = removeTrailingSlash(pathname);

				if (this.nextConfig.i18n) {
					const localePathResult = normalizeLocalePath(
						pathname,
						this.nextConfig.i18n?.locales,
					);

					if (localePathResult.detectedLocale) {
						pathname = localePathResult.pathname;
						parsedUrl.query.__nextLocale = localePathResult.detectedLocale;
					}
				}

				const bubbleNoFallback = Boolean(query._nextBubbleNoFallback);

				if (pathname === '/api' || pathname?.startsWith('/api/')) {
					delete query._nextBubbleNoFallback;

					const handled = await this.handleApiRequest(
						request,
						res,
						pathname,
						query,
					);
					if (handled) {
						return {finished: true};
					}
				}

				try {
					await this.renderer.render(
						request,
						res,
						pathname,
						query,
						parsedUrl,
						true,
					);

					return {
						finished: true,
					};
				} catch (error: unknown) {
					if (error instanceof NoFallbackError && bubbleNoFallback) {
						return {
							finished: false,
						};
					}

					throw error;
				}
			},
		};

		return {
			headers,
			fsRoutes,
			rewrites,
			redirects,
			catchAllRoute,
			catchAllMiddleware,
			useFileSystemPublicRoutes: true,
			dynamicRoutes: this.dynamicRoutes,
			pageChecker: this.pageChecker.hasPage.bind(this.pageChecker),
			nextConfig: this.nextConfig,
		};
	}

	protected async handleApiRequest(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: BaseNextResponse,
		pathname: string,
		query: ParsedUrlQuery,
	): Promise<boolean> {
		let page = pathname;
		let parameters: Params | undefined;
		let pageFound =
			!isDynamicRoute(page) && (await this.pageChecker.hasPage(page));

		if (!pageFound && this.dynamicRoutes) {
			for (const dynamicRoute of this.dynamicRoutes) {
				parameters = dynamicRoute.match(pathname) || undefined;
				if (dynamicRoute.page.startsWith('/api') && parameters) {
					page = dynamicRoute.page;
					pageFound = true;
					break;
				}
			}
		}

		if (!pageFound) {
			return false;
		}

		return this.runApi(request, res as any, query, parameters, page);
	}

	// eslint-disable-next-line max-params
	protected async runApi(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: WebNextResponse,
		query: ParsedUrlQuery,
		parameters: Params | undefined,
		page: string,
	): Promise<boolean> {
		const func = await this.loadFunction(page);
		if (!func) {
			return false;
		}

		// For edge to "fetch" we must always provide an absolute URL
		const isDataRequest = Boolean(query.__nextDataReq);
		const initialUrl = new URL(
			getRequestMeta(request, '__NEXT_INIT_URL') ?? '/',
			'http://n',
		);
		const queryString = urlQueryToSearchParams({
			...Object.fromEntries(initialUrl.searchParams),
			...query,
			...parameters,
		}).toString();

		if (isDataRequest) {
			request.headers['x-nextjs-data'] = '1';
		}

		initialUrl.search = queryString;
		const url = initialUrl.toString();

		if (!url.startsWith('http')) {
			throw new Error(
				'To use middleware you must provide a `hostname` and `port` to the Next.js Server',
			);
		}

		const cloned = ['HEAD', 'GET'].includes(request.method)
			? undefined
			: getRequestMeta(request, '__NEXT_CLONABLE_BODY')?.cloneBodyStream();

		const result = await adapter({
			handler: func,
			page,
			request: {
				headers: request.headers,
				method: request.method,
				nextConfig: {
					basePath: this.nextConfig.basePath,
					i18n: this.nextConfig.i18n,
					trailingSlash: this.nextConfig.trailingSlash,
				},
				url,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				page: {
					name: page,
					...(parameters && {params: parameters}),
				} as any,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				body: cloned
					? // eslint-disable-next-line @typescript-eslint/naming-convention
					  requestToBodyStream({ReadableStream}, Uint8Array, cloned)
					: undefined,
			},
		});

		res.statusCode = result.response.status;
		res.statusMessage = result.response.statusText;

		// eslint-disable-next-line unicorn/no-array-for-each
		result.response.headers.forEach((value: string, key: string) => {
			// The append handling is special cased for `set-cookie`
			if (key.toLowerCase() === 'set-cookie') {
				res.setHeader(key, value);
			} else {
				res.appendHeader(key, value);
			}
		});

		if (result.response.body) {
			result.response.body.pipeThrough(res.transformStream);
		}

		res.send();

		return true;
	}

	protected generateCatchAllMiddlewareRoute(): Route[] {
		const routes = [];
		if (this.getMiddleware()) {
			const middlewareCatchAllRoute: Route = {
				match: getPathMatch('/:path*'),
				matchesBasePath: true,
				matchesLocale: true,
				type: 'route',
				name: 'middleware catchall',
				// eslint-disable-next-line complexity, unicorn/prevent-abbreviations
				fn: async (request, res, _parameters, parsed) => {
					const middleware = this.getMiddleware();
					if (!middleware) {
						return {finished: false};
					}

					const initUrl = getRequestMeta(request, '__NEXT_INIT_URL')!;
					const parsedUrl = parseUrl(initUrl);
					const pathnameInfo = getNextPathnameInfo(parsedUrl.pathname, {
						nextConfig: this.nextConfig,
					});

					parsedUrl.pathname = pathnameInfo.pathname;
					const normalizedPathname = removeTrailingSlash(parsed.pathname ?? '');
					if (!middleware.match(normalizedPathname, request, parsedUrl.query)) {
						return {finished: false};
					}

					let result: Awaited<
						ReturnType<typeof IgnextRouterBuilder.prototype.runMiddleware>
					>;

					try {
						result = await this.runMiddleware({
							request,
							response: res,
							parsedUrl,
							parsed,
						});
					} catch (error_: unknown) {
						if (isError(error_) && error_.code === 'ENOENT') {
							await this.renderer.render404(request, res, parsed);
							return {finished: true};
						}

						if (error_ instanceof DecodeError) {
							res.statusCode = 400;
							await this.renderer.renderError(
								error_,
								request,
								res,
								parsed.pathname ?? '',
							);
							return {finished: true};
						}

						const error = getProperError(error_);
						console.error(error);
						res.statusCode = 500;
						await this.renderer.renderError(
							error,
							request,
							res,
							parsed.pathname ?? '',
						);
						return {finished: true};
					}

					if ('finished' in result) {
						return result;
					}

					if (result.response.headers.has('x-middleware-rewrite')) {
						const value = result.response.headers.get('x-middleware-rewrite')!;
						const rel = relativizeURL(value, initUrl);
						result.response.headers.set('x-middleware-rewrite', rel);
					}

					if (result.response.headers.has('Location')) {
						const value = result.response.headers.get('Location')!;
						const rel = relativizeURL(value, initUrl);
						result.response.headers.set('Location', rel);
					}

					if (
						!result.response.headers.has('x-middleware-rewrite') &&
						!result.response.headers.has('x-middleware-next') &&
						!result.response.headers.has('Location')
					) {
						result.response.headers.set('x-middleware-refresh', '1');
					}

					result.response.headers.delete('x-middleware-next');

					for (const [key, value] of Object.entries(
						toNodeHeaders(result.response.headers),
					)) {
						if (
							[
								'x-middleware-rewrite',
								'x-middleware-redirect',
								'x-middleware-refresh',
							].includes(key)
						) {
							continue;
						}

						if (key !== 'content-encoding' && value !== undefined) {
							res.setHeader(key, value);
						}
					}

					res.statusCode = result.response.status;
					res.statusMessage = result.response.statusText;

					const location = result.response.headers.get('Location');
					if (location) {
						res.statusCode = result.response.status;
						if (res.statusCode === 308) {
							res.setHeader('Refresh', `0;url=${location}`);
						}

						res.body(location).send();
						return {
							finished: true,
						};
					}

					if (result.response.headers.has('x-middleware-rewrite')) {
						const rewritePath = result.response.headers.get(
							'x-middleware-rewrite',
						)!;
						const parsedDestination = parseUrl(rewritePath);
						const newUrl = parsedDestination.pathname;

						if (
							parsedDestination.protocol &&
							(parsedDestination.port
								? // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
								  `${parsedDestination.hostname}:${parsedDestination.port}`
								: parsedDestination.hostname) !== request.headers.host
						) {
							throw new Error("Doesn't support proxy request yet");
						}

						if (this.nextConfig.i18n) {
							const localePathResult = normalizeLocalePath(
								newUrl,
								this.nextConfig.i18n.locales,
							);
							if (localePathResult.detectedLocale) {
								parsedDestination.query.__nextLocale =
									localePathResult.detectedLocale;
							}
						}

						addRequestMeta(request, '_nextRewroteUrl', newUrl);
						addRequestMeta(request, '_nextDidRewrite', newUrl !== request.url);

						return {
							finished: false,
							pathname: newUrl,
							query: parsedDestination.query,
						};
					}

					if (result.response.headers.has('x-middleware-refresh')) {
						res.statusCode = result.response.status;
						for await (const chunk of result.response.body ?? ([] as any)) {
							// TODO: send response body here
						}

						res.send();
						return {
							finished: true,
						};
					}

					return {
						finished: false,
					};
				},
			};

			routes.push(middlewareCatchAllRoute);
		}

		return routes;
	}

	protected getMiddleware(): MiddlewareRoutingItem | undefined {
		const manifest = this.manifestProvider.getMiddlewareManifest();
		const middleware = manifest?.middleware?.['/'];
		if (!middleware) {
			return;
		}

		return {
			match: getMiddlewareMatcher(middleware),
			page: '/',
		};
	}

	protected async runMiddleware(parameters: {
		request: BaseNextRequest;
		response: BaseNextResponse;
		parsedUrl: ParsedUrl;
		parsed: UrlWithParsedQuery;
		onWarning?: (warning: Error) => void;
	}): Promise<FetchEventResult | {finished: boolean}> {
		// TODO: run middleware here, fix return type
		return {finished: false, response: NextResponse.next()};
	}
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const MiddlewareMatcherCache = new WeakMap<
	MiddlewareManifest['middleware'][string],
	MiddlewareRouteMatch
>();

function getMiddlewareMatcher(
	info: MiddlewareManifest['middleware'][string],
): MiddlewareRouteMatch {
	const stored = MiddlewareMatcherCache.get(info);
	if (stored) {
		return stored;
	}

	if (!Array.isArray(info.matchers)) {
		throw new TypeError(
			`Invariant: invalid matchers for middleware ${JSON.stringify(info)}`,
		);
	}

	const matcher = getMiddlewareRouteMatcher(info.matchers);
	MiddlewareMatcherCache.set(info, matcher);
	return matcher;
}
