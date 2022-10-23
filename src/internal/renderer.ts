/* eslint-disable n/no-deprecated-api */
/* eslint-disable unicorn/prefer-node-protocol */
import type {UrlWithParsedQuery} from 'url';
import {format as formatUrl, parse as parseUrl} from 'url';
import * as Log from 'next/dist/build/output/log';
import {getProperError} from 'next/dist/lib/is-error';
import {getRedirectStatus} from 'next/dist/lib/redirect-status';
import {checkIsManualRevalidate} from 'next/dist/server/api-utils';
import {byteLength} from 'next/dist/server/api-utils/web';
import {renderToHTMLOrFlight} from 'next/dist/server/app-render';
import {BaseNextRequest, BaseNextResponse} from 'next/dist/server/base-http';
import {WebNextResponse} from 'next/dist/server/base-http/web';
import BaseServer, {
	FindComponentsResult,
	NoFallbackError,
	RequestContext,
} from 'next/dist/server/base-server';
import {NextConfigComplete} from 'next/dist/server/config-shared';
import {generateETag} from 'next/dist/server/lib/etag';
import {LoadComponentsReturnType} from 'next/dist/server/load-components';
import {RenderOpts, renderToHTML} from 'next/dist/server/render';
import RenderResult from 'next/dist/server/render-result';
import {
	getRequestMeta,
	NextParsedUrlQuery,
	NextUrlWithParsedQuery,
} from 'next/dist/server/request-meta';
import {
	ResponseCacheBase,
	ResponseCacheEntry,
	ResponseCacheValue,
} from 'next/dist/server/response-cache';
import {DynamicRoutes} from 'next/dist/server/router';
import {
	PayloadOptions,
	setRevalidateHeaders,
} from 'next/dist/server/send-payload';
import {isBlockedPage} from 'next/dist/server/utils';
import {isBot} from 'next/dist/server/web/spec-extension/user-agent';
import {
	NEXT_BUILTIN_DOCUMENT,
	STATIC_STATUS_PAGES,
} from 'next/dist/shared/lib/constants';
import {normalizeLocalePath} from 'next/dist/shared/lib/i18n/normalize-locale-path';
import {denormalizePagePath} from 'next/dist/shared/lib/page-path/denormalize-page-path';
import {normalizeAppPath} from 'next/dist/shared/lib/router/utils/app-paths';
import escapePathDelimiters from 'next/dist/shared/lib/router/utils/escape-path-delimiters';
import {isDynamicRoute} from 'next/dist/shared/lib/router/utils/is-dynamic';
import {removeTrailingSlash} from 'next/dist/shared/lib/router/utils/remove-trailing-slash';
import {Params} from 'next/dist/shared/lib/router/utils/route-matcher';
import {
	DecodeError,
	execOnce,
	MissingStaticPage,
	NormalizeError,
	normalizeRepeatedSlashes,
} from 'next/dist/shared/lib/utils';
import {Logger} from './logger';
import {ManifestProvider} from './manifest-provider';
import {PageChecker} from './page-checker';

type ResponsePayload = {
	type: 'html' | 'json' | 'rsc';
	body: RenderResult;
	revalidateOptions?: any;
};

// Internal wrapper around build errors at development
// time, to prevent us from propagating or logging them
class WrappedBuildError extends Error {
	innerError: Error;

	constructor(innerError: Error) {
		super();
		this.innerError = innerError;
	}
}

interface RendererOptions {
	nextConfig: NextConfigComplete;
	renderOpts: BaseServer['renderOpts'];
	pageChecker: PageChecker;
	manifestProvider: ManifestProvider;
	responseCache: ResponseCacheBase;
	logger: Logger;
	dynamicRoutes: DynamicRoutes;
	hasMiddleware: boolean;
}

export abstract class Renderer {
	private readonly customErrorNo404Warn = execOnce(() => {
		Log.warn(
			`You have added a custom /_error page without a custom /404 page. This prevents the 404 page from being auto statically optimized.\nSee here for info: https://nextjs.org/docs/messages/custom-error-no-custom-404`,
		);
	});

	private readonly appPathRoutes: Record<string, string[]>;

	private readonly nextConfig: NextConfigComplete;
	private readonly renderOpts: BaseServer['renderOpts'];
	private readonly pageChecker: PageChecker;
	private readonly manifestProvider: ManifestProvider;
	private readonly responseCache: ResponseCacheBase;
	private readonly logger: Logger;
	private readonly dynamicRoutes: DynamicRoutes;
	private readonly hasMiddleware: boolean;

	constructor(options: RendererOptions) {
		this.nextConfig = options.nextConfig;
		this.renderOpts = options.renderOpts;
		this.pageChecker = options.pageChecker;
		this.manifestProvider = options.manifestProvider;
		this.responseCache = options.responseCache;
		this.logger = options.logger;
		this.dynamicRoutes = options.dynamicRoutes;
		this.hasMiddleware = options.hasMiddleware;

		this.appPathRoutes = this.getAppPathRoutes();
	}

	// eslint-disable-next-line max-params
	public async render(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: BaseNextResponse,
		pathname: string,
		query: NextParsedUrlQuery = {},
		parsedUrl?: NextUrlWithParsedQuery,
		internalRender = false,
	): Promise<void> {
		if (!pathname.startsWith('/')) {
			console.warn(
				`Cannot render page with path "${pathname}", did you mean "/${pathname}"?. See more info here: https://nextjs.org/docs/messages/render-no-starting-slash`,
			);
		}

		if (
			this.renderOpts.customServer &&
			pathname === '/index' &&
			!(await this.pageChecker.hasPage('/index'))
		) {
			// Maintain backwards compatibility for custom server
			// (see custom-server integration tests)
			pathname = '/';
		}

		if (isBlockedPage(pathname)) {
			return this.render404(request, res, parsedUrl);
		}

		return this.pipe(async (ctx) => this.renderToResponse(ctx), {
			req: request,
			res,
			pathname,
			query,
		});
	}

	public async render404(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: BaseNextResponse,
		parsedUrl?: NextUrlWithParsedQuery,
		setHeaders = true,
	): Promise<void> {
		const {pathname, query}: NextUrlWithParsedQuery = parsedUrl
			? parsedUrl
			: parseUrl(request.url, true);

		if (this.nextConfig.i18n) {
			query.__nextLocale =
				query.__nextLocale ?? this.nextConfig.i18n.defaultLocale;
			query.__nextDefaultLocale =
				query.__nextDefaultLocale ?? this.nextConfig.i18n.defaultLocale;
		}

		res.statusCode = 404;
		return this.renderError(
			undefined,
			request,
			res,
			pathname!,
			query,
			setHeaders,
		);
	}

	// eslint-disable-next-line max-params
	public async renderError(
		error: Error | undefined,
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: BaseNextResponse,
		pathname: string,
		query: NextParsedUrlQuery = {},
		setHeaders = true,
	): Promise<void> {
		if (setHeaders) {
			res.setHeader(
				'Cache-Control',
				'no-cache, no-store, max-age=0, must-revalidate',
			);
		}

		return this.pipe(
			async (ctx) => {
				const response = await this.renderErrorToResponse(ctx, error);

				return response;
			},
			{req: request, res, pathname, query},
		);
	}

	protected async getFallbackErrorComponents(): Promise<
		LoadComponentsReturnType | undefined
	> {
		// The development server will provide an implementation for this
		return undefined;
	}

	protected async getStaticPaths({
		pathname,
	}: {
		pathname: string;
		originalAppPath?: string;
	}): Promise<{
		staticPaths?: string[];
		fallbackMode?: 'static' | 'blocking' | false;
	}> {
		// `staticPaths` is intentionally set to `undefined` as it should've
		// been caught when checking disk data.
		const staticPaths = undefined;

		// Read whether or not fallback should exist from the manifest.
		const fallbackField =
			this.manifestProvider.getPrerenderManifest().dynamicRoutes[pathname]
				?.fallback;

		return {
			staticPaths,
			fallbackMode:
				typeof fallbackField === 'string'
					? 'static'
					: fallbackField === null
					? 'blocking'
					: fallbackField,
		};
	}

	protected getAppPathRoutes(): Record<string, string[]> {
		const appPathRoutes: Record<string, string[]> = {};

		for (const entry of Object.keys(
			this.manifestProvider.getAppPathsManifest() ?? {},
		)) {
			const normalizedPath = normalizeAppPath(entry) || '/';
			if (!appPathRoutes[normalizedPath]) {
				appPathRoutes[normalizedPath] = [];
			}

			appPathRoutes[normalizedPath].push(entry);
		}

		return appPathRoutes;
	}

	protected getOriginalAppPaths(route: string) {
		const originalAppPath = this.appPathRoutes?.[route];

		if (!originalAppPath) {
			return undefined;
		}

		return originalAppPath;
	}

	protected async renderPageComponent(
		ctx: RequestContext,
		bubbleNoFallback: boolean,
	) {
		const {query, pathname} = ctx;

		const appPaths = this.getOriginalAppPaths(pathname);
		const isAppPath = Array.isArray(appPaths);

		let page = pathname;
		if (isAppPath) {
			// When it's an array, we need to pass all parallel routes to the loader.
			page = appPaths[0];
		}

		const result = await this.findPageComponents({
			pathname: page,
			query,
			params: ctx.renderOpts.params ?? {},
			isAppPath,
			appPaths,
			sriEnabled: Boolean(this.nextConfig.experimental?.sri?.algorithm),
		});
		if (result) {
			try {
				return await this.renderToResponseWithComponents(ctx, result);
			} catch (error: unknown) {
				const isNoFallbackError = error instanceof NoFallbackError;

				if (!isNoFallbackError || (isNoFallbackError && bubbleNoFallback)) {
					throw error;
				}
			}
		}

		return false;
	}

	protected abstract sendRenderResult(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: BaseNextResponse,
		options: {
			result: RenderResult;
			type: 'html' | 'json' | 'rsc';
			generateEtags: boolean;
			poweredByHeader: boolean;
			options?: PayloadOptions;
		},
	): Promise<void>;

	protected abstract getFallback(page: string): Promise<string>;

	protected abstract findPageComponents(parameters: {
		pathname: string;
		query: NextParsedUrlQuery;
		params: Params;
		isAppPath: boolean;
		appPaths?: string[];
		sriEnabled?: boolean;
	}): Promise<FindComponentsResult | undefined>;

	// eslint-disable-next-line @typescript-eslint/naming-convention
	protected abstract renderHTML(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: BaseNextResponse,
		pathname: string,
		query: NextParsedUrlQuery,
		renderOptions: RenderOpts,
	): Promise<RenderResult | undefined>;

	private async pipe(
		fn: (ctx: RequestContext) => Promise<ResponsePayload | undefined>,
		partialContext: {
			req: BaseNextRequest;
			res: BaseNextResponse;
			pathname: string;
			query: NextParsedUrlQuery;
		},
	): Promise<void> {
		const isBotRequest = isBot(partialContext.req.headers['user-agent'] ?? '');
		const ctx = {
			...partialContext,
			renderOpts: {
				...this.renderOpts,
				// eslint-disable-next-line @typescript-eslint/naming-convention
				supportsDynamicHTML: !isBotRequest,
			},
		} as const;
		const payload = await fn(ctx);
		if (!payload) {
			return;
		}

		const {req, res} = ctx;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const {body, type, revalidateOptions} = payload;
		if (!res.sent) {
			const {generateEtags, poweredByHeader, dev} = this.renderOpts;
			if (dev) {
				// In dev, we should not cache pages for any reason.
				res.setHeader('Cache-Control', 'no-store, must-revalidate');
			}

			return this.sendRenderResult(req, res, {
				result: body,
				type,
				generateEtags,
				poweredByHeader,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				options: revalidateOptions,
			});
		}
	}

	private async renderErrorToResponse(
		ctx: RequestContext,
		error: Error | undefined,
	): Promise<ResponsePayload | undefined> {
		const {res, query} = ctx;
		try {
			let result: undefined | FindComponentsResult;

			const is404 = res.statusCode === 404;
			let using404Page = false;

			// Use static 404 page if available and is 404 response
			if (is404 && (await this.pageChecker.hasPage('/404'))) {
				result = await this.findPageComponents({
					pathname: '/404',
					query,
					params: {},
					isAppPath: false,
				});
				using404Page = result !== null;
			}

			let statusPage = `/${res.statusCode!}`;

			if (
				!ctx.query.__nextCustomErrorRender &&
				!result &&
				STATIC_STATUS_PAGES.includes(statusPage) && // Skip ensuring /500 in dev mode as it isn't used and the
				// dev overlay is used instead
				(statusPage !== '/500' || !this.renderOpts.dev)
			) {
				result = await this.findPageComponents({
					pathname: statusPage,
					query,
					params: {},
					isAppPath: false,
				});
			}

			if (!result) {
				result = await this.findPageComponents({
					pathname: '/_error',
					query,
					params: {},
					isAppPath: false,
				});
				statusPage = '/_error';
			}

			if (
				process.env.NODE_ENV !== 'production' &&
				!using404Page &&
				(await this.pageChecker.hasPage('/_error')) &&
				!(await this.pageChecker.hasPage('/404'))
			) {
				this.customErrorNo404Warn();
			}

			try {
				return await this.renderToResponseWithComponents(
					{
						...ctx,
						pathname: statusPage,
						renderOpts: {
							...ctx.renderOpts,
							err: error,
						},
					},
					result!,
				);
			} catch (maybeFallbackError: unknown) {
				if (maybeFallbackError instanceof NoFallbackError) {
					throw new TypeError('invariant: failed to render error page');
				}

				throw maybeFallbackError;
			}
		} catch (error: unknown) {
			const renderToHtmlError = getProperError(error);
			const isWrappedError = renderToHtmlError instanceof WrappedBuildError;
			if (!isWrappedError) {
				this.logger.logError(renderToHtmlError);
			}

			res.statusCode = 500;
			const fallbackComponents = await this.getFallbackErrorComponents();

			if (fallbackComponents) {
				return this.renderToResponseWithComponents(
					{
						...ctx,
						pathname: '/_error',
						renderOpts: {
							...ctx.renderOpts,
							// We render `renderToHtmlError` here because `err` is
							// already captured in the stacktrace.
							err: isWrappedError
								? renderToHtmlError.innerError
								: renderToHtmlError,
						},
					},
					{
						query,
						components: fallbackComponents,
					},
				);
			}

			return {
				type: 'html',
				body: RenderResult.fromStatic('Internal Server Error'),
			};
		}
	}

	// eslint-disable-next-line complexity
	private async renderToResponseWithComponents(
		{req, res, pathname, renderOpts: options}: RequestContext,
		{components, query}: FindComponentsResult,
	): Promise<ResponsePayload | undefined> {
		const is404Page = pathname === '/404';
		const is500Page = pathname === '/500';
		const {isAppPath} = components;

		const isLikeServerless =
			typeof components.ComponentMod === 'object' &&
			typeof components.ComponentMod.renderReqToHTML === 'function';
		const hasServerProps = Boolean(components.getServerSideProps);
		let hasStaticPaths = Boolean(components.getStaticPaths);

		const hasGetInitialProps = Boolean(components.Component?.getInitialProps);
		// eslint-disable-next-line @typescript-eslint/naming-convention
		let isSSG = Boolean(components.getStaticProps);

		// Compute the iSSG cache key. We use the rewroteUrl since
		// pages with fallback: false are allowed to be rewritten to
		// and we need to look up the path by the rewritten path
		let urlPathname = parseUrl(req.url || '').pathname ?? '/';

		let resolvedUrlPathname =
			getRequestMeta(req, '_nextRewroteUrl') ?? urlPathname;

		let staticPaths: string[] | undefined;
		let fallbackMode: false | undefined | 'blocking' | 'static';

		if (isAppPath) {
			const pathsResult = await this.getStaticPaths({
				pathname,
				originalAppPath: components.pathname,
			});

			staticPaths = pathsResult.staticPaths;
			fallbackMode = pathsResult.fallbackMode;

			const hasFallback = typeof fallbackMode !== 'undefined';

			if (hasFallback) {
				hasStaticPaths = true;
			}

			if (hasFallback || staticPaths?.includes(resolvedUrlPathname)) {
				isSSG = true;
			} else if (!this.renderOpts.dev) {
				const manifest = this.manifestProvider.getPrerenderManifest();
				isSSG =
					isSSG ||
					Boolean(manifest.routes[pathname === '/index' ? '/' : pathname]);
			}
		}

		// Toggle whether or not this is a Data request
		let isDataRequest =
			Boolean(query.__nextDataReq) && (isSSG || hasServerProps);

		if (isAppPath && req.headers.__rsc__ && isSSG) {
			isDataRequest = true;
			// Not sure exactly what this is doing.
			// Seems always true.
			// Strip header so we generate HTML still
			// if (
			// 	options.runtime !== 'experimental-edge' ||
			// 	(this.serverOptions as any).webServerConfig
			// ) {
			delete req.headers.__rsc__;
			delete req.headers.__next_router_state_tree__;
			delete req.headers.__next_router_prefetch__;
			// }
		}

		delete query.__nextDataReq;

		if (
			Boolean(req.headers['x-nextjs-data']) &&
			(!res.statusCode || res.statusCode === 200)
		) {
			res.setHeader(
				'x-nextjs-matched-path',
				`${query.__nextLocale ? `/${query.__nextLocale}` : ''}${pathname}`,
			);
		}

		// Don't delete query.__rsc__ yet, it still needs to be used in renderToHTML later
		const isFlightRequest = Boolean(
			this.manifestProvider.getServerComponentManifest() && req.headers.__rsc__,
		);

		// We need to ensure the status code if /404 is visited directly
		if (is404Page && !isDataRequest && !isFlightRequest) {
			res.statusCode = 404;
		}

		// Ensure correct status is set when visiting a status page
		// directly e.g. /500
		if (STATIC_STATUS_PAGES.includes(pathname)) {
			res.statusCode = Number.parseInt(pathname.slice(1), 10);
		}

		// Static pages can only respond to GET/HEAD
		// requests so ensure we respond with 405 for
		// invalid requests
		if (
			!is404Page &&
			!is500Page &&
			pathname !== '/_error' &&
			req.method !== 'HEAD' &&
			req.method !== 'GET' &&
			(typeof components.Component === 'string' || isSSG)
		) {
			res.statusCode = 405;
			res.setHeader('Allow', ['GET', 'HEAD']);
			await this.renderError(undefined, req, res, pathname);
			return undefined;
		}

		// Handle static page
		if (typeof components.Component === 'string') {
			return {
				type: 'html',
				// eslint-disable-next-line no-warning-comments
				// TODO: Static pages should be serialized as RenderResult
				body: RenderResult.fromStatic(components.Component),
			};
		}

		if (!query.amp) {
			delete query.amp;
		}

		if (options.supportsDynamicHTML === true) {
			const isBotRequest = isBot(req.headers['user-agent'] ?? '');
			const isSupportedDocument =
				typeof components.Document?.getInitialProps !== 'function' ||
				// When concurrent features is enabled, the built-in `Document`
				// component also supports dynamic HTML.
				(Boolean(process.env.__NEXT_REACT_ROOT) &&
					NEXT_BUILTIN_DOCUMENT in components.Document);

			// Disable dynamic HTML in cases that we know it won't be generated,
			// so that we can continue generating a cache key when possible.
			// TODO-APP: should the first render for a dynamic app path
			// be static so we can collect revalidate and populate the
			// cache if there are no dynamic data requirements

			options.supportsDynamicHTML =
				!isSSG &&
				!isLikeServerless &&
				!isBotRequest &&
				!query.amp &&
				isSupportedDocument;
		}

		const defaultLocale = isSSG
			? this.nextConfig.i18n?.defaultLocale
			: query.__nextDefaultLocale;

		const locale = query.__nextLocale;
		const locales = this.nextConfig.i18n?.locales;

		const isPreviewMode = false;

		let isManualRevalidate = false;
		let revalidateOnlyGenerated = false;

		if (isSSG) {
			({isManualRevalidate, revalidateOnlyGenerated} = checkIsManualRevalidate(
				req,
				this.renderOpts.previewProps,
			));
		}

		urlPathname = removeTrailingSlash(urlPathname);
		resolvedUrlPathname = normalizeLocalePath(
			removeTrailingSlash(resolvedUrlPathname),
			this.nextConfig.i18n?.locales,
		).pathname;

		const handleRedirect = (pageData: any) => {
			const redirect = {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				destination: pageData.pageProps.__N_REDIRECT,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				statusCode: pageData.pageProps.__N_REDIRECT_STATUS,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				basePath: pageData.pageProps.__N_REDIRECT_BASE_PATH,
			};
			const statusCode = getRedirectStatus(redirect);
			const {basePath} = this.nextConfig;

			if (
				basePath &&
				redirect.basePath !== false &&
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call
				redirect.destination.startsWith('/')
			) {
				// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
				redirect.destination = `${basePath}${redirect.destination}`;
			}

			// eslint-disable-next-line @typescript-eslint/no-unsafe-call
			if (redirect.destination.startsWith('/')) {
				redirect.destination = normalizeRepeatedSlashes(redirect.destination);
			}

			res
				.redirect(redirect.destination, statusCode)
				.body(redirect.destination)
				.send();
		};

		// Remove /_next/data prefix from urlPathname so it matches
		// for direct page visit and /_next/data visit
		if (isDataRequest) {
			resolvedUrlPathname = this.stripNextDataPath(resolvedUrlPathname);
			urlPathname = this.stripNextDataPath(urlPathname);
		}

		let ssgCacheKey =
			isPreviewMode || !isSSG || options.supportsDynamicHTML
				? null // Preview mode, manual revalidate, flight request can bypass the cache
				: `${locale ? `/${locale}` : ''}${
						(pathname === '/' || resolvedUrlPathname === '/') && locale
							? ''
							: resolvedUrlPathname
				  }${query.amp ? '.amp' : ''}`;

		if ((is404Page || is500Page) && isSSG) {
			ssgCacheKey = `${locale ? `/${locale}` : ''}${pathname}${
				query.amp ? '.amp' : ''
			}`;
		}

		if (ssgCacheKey) {
			// We only encode path delimiters for path segments from
			// getStaticPaths so we need to attempt decoding the URL
			// to match against and only escape the path delimiters
			// this allows non-ascii values to be handled e.g. Japanese characters

			// eslint-disable-next-line no-warning-comments
			// TODO: investigate adding this handling for non-SSG pages so
			// non-ascii names work there also
			ssgCacheKey = ssgCacheKey
				.split('/')
				.map((seg) => {
					try {
						seg = escapePathDelimiters(decodeURIComponent(seg), true);
					} catch {
						// An improperly encoded URL was provided
						throw new DecodeError('failed to decode param');
					}

					return seg;
				})
				.join('/');

			// Ensure /index and / is normalized to one key
			ssgCacheKey =
				ssgCacheKey === '/index' && pathname === '/' ? '/' : ssgCacheKey;
		}

		const doRender: () => Promise<
			ResponseCacheEntry | undefined
		> = async () => {
			let pageData: any;
			let body: RenderResult | undefined;
			let sprRevalidate: number | false;
			let isNotFound: boolean | undefined;
			let isRedirect: boolean | undefined;

			const origQuery = parseUrl(req.url || '', true).query;

			// Clear any dynamic route params so they aren't in
			// the resolvedUrl
			if (options.params) {
				for (const key of Object.keys(options.params)) {
					// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
					delete origQuery[key];
				}
			}

			const hadTrailingSlash =
				urlPathname !== '/' && this.nextConfig.trailingSlash;

			const resolvedUrl = formatUrl({
				pathname: `${resolvedUrlPathname}${hadTrailingSlash ? '/' : ''}`,
				// Make sure to only add query values from original URL
				query: origQuery,
			});

			const renderOptions: RenderOpts = {
				...components,
				...options,
				isDataReq: isDataRequest,
				resolvedUrl,
				locale,
				locales,
				defaultLocale,
				// For getServerSideProps and getInitialProps we need to ensure we use the original URL
				// and not the resolved URL to prevent a hydration mismatch on
				// asPath
				resolvedAsPath:
					hasServerProps || hasGetInitialProps
						? formatUrl({
								// We use the original URL pathname less the _next/data prefix if
								// present
								pathname: `${urlPathname}${hadTrailingSlash ? '/' : ''}`,
								query: origQuery,
						  })
						: resolvedUrl,
			};

			if (isSSG || hasStaticPaths) {
				renderOptions.supportsDynamicHTML = false;
			}

			const renderResult = await this.renderHTML(
				req,
				res,
				pathname,
				query,
				renderOptions,
			);

			// eslint-disable-next-line prefer-const
			body = renderResult;
			// eslint-disable-next-line no-warning-comments
			// TODO: change this to a different passing mechanism
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, prefer-const
			pageData = (renderOptions as any).pageData;
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, prefer-const
			sprRevalidate = (renderOptions as any).revalidate;
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, prefer-const
			isNotFound = (renderOptions as any).isNotFound;
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, prefer-const
			isRedirect = (renderOptions as any).isRedirect;

			let value: ResponseCacheValue | undefined;
			if (isNotFound) {
				value = undefined;
			} else if (isRedirect) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				value = {kind: 'REDIRECT', props: pageData};
			} else {
				if (!body) {
					return undefined;
				}

				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				value = {kind: 'PAGE', html: body, pageData};
			}

			return {revalidate: sprRevalidate, value: value ?? null};
		};

		const cacheEntry = await this.responseCache.get(
			ssgCacheKey,
			// eslint-disable-next-line complexity
			async (hasResolved, hadCache) => {
				const isProduction = !this.renderOpts.dev;
				const isDynamicPathname = isDynamicRoute(pathname);
				const didRespond = hasResolved || res.sent;

				if (!staticPaths) {
					({staticPaths, fallbackMode} = hasStaticPaths
						? await this.getStaticPaths({pathname})
						: {staticPaths: undefined, fallbackMode: false});
				}

				if (
					fallbackMode === 'static' &&
					isBot(req.headers['user-agent'] || '')
				) {
					fallbackMode = 'blocking';
				}

				// Skip manual revalidate if cache is not present and
				// revalidate-if-generated is set
				if (isManualRevalidate && revalidateOnlyGenerated && !hadCache) {
					await this.render404(req, res);
					return null;
				}

				// Only allow manual revalidate for fallback: true/blocking
				// or for prerendered fallback: false paths
				if (isManualRevalidate && (fallbackMode !== false || hadCache)) {
					fallbackMode = 'blocking';
				}

				// When we did not respond from cache, we need to choose to block on
				// rendering or return a skeleton.
				//
				// * Data requests always block.
				//
				// * Blocking mode fallback always blocks.
				//
				// * Preview mode toggles all pages to be resolved in a blocking manner.
				//
				// * Non-dynamic pages should block (though this is an impossible
				//   case in production).
				//
				// * Dynamic pages should return their skeleton if not defined in
				//   getStaticPaths, then finish the data request on the client-side.
				//
				if (
					process.env.NEXT_RUNTIME !== 'edge' &&
					fallbackMode !== 'blocking' &&
					ssgCacheKey &&
					!didRespond &&
					!isPreviewMode &&
					isDynamicPathname &&
					// Development should trigger fallback when the path is not in
					// `getStaticPaths`
					(isProduction ||
						!staticPaths ||
						!staticPaths.includes(
							// We use ssgCacheKey here as it is normalized to match the
							// encoding from getStaticPaths along with including the locale
							query.amp ? ssgCacheKey.replace(/\.amp$/, '') : ssgCacheKey,
						))
				) {
					if (
						// In development, fall through to render to handle missing
						// getStaticPaths.
						(isProduction || staticPaths) &&
						// When fallback isn't present, abort this render so we 404
						fallbackMode !== 'static'
					) {
						throw new NoFallbackError();
					}

					if (!isDataRequest) {
						// Production already emitted the fallback as static HTML.
						if (isProduction) {
							const html = await this.getFallback(
								locale ? `/${locale}${pathname}` : pathname,
							);
							return {
								value: {
									kind: 'PAGE',
									html: RenderResult.fromStatic(html),
									pageData: {},
								},
							};
						}
						// We need to generate the fallback on-demand for development.

						query.__nextFallback = 'true';

						const result = await doRender();
						if (!result) {
							return null;
						}

						// Prevent caching this result
						delete result.revalidate;
						return result;
					}
				}

				const result = await doRender();
				if (!result) {
					return null;
				}

				return {
					...result,
					revalidate:
						// eslint-disable-next-line no-negated-condition
						result.revalidate !== undefined
							? result.revalidate
							: /* default to minimum revalidate (this should be an invariant) */ 1,
				};
			},
			{
				isManualRevalidate,
				isPrefetch: req.headers.purpose === 'prefetch',
			},
		);

		if (!cacheEntry) {
			if (ssgCacheKey && !(isManualRevalidate && revalidateOnlyGenerated)) {
				// A cache entry might not be generated if a response is written
				// in `getInitialProps` or `getServerSideProps`, but those shouldn't
				// have a cache key. If we do have a cache key but we don't end up
				// with a cache entry, then either Next.js or the application has a
				// bug that needs fixing.
				throw new Error('invariant: cache entry required but not generated');
			}

			return undefined;
		}

		if (isSSG) {
			// Set x-nextjs-cache header to match the header
			// we set for the image-optimizer
			res.setHeader(
				'x-nextjs-cache',
				isManualRevalidate
					? 'REVALIDATED'
					: cacheEntry.isMiss
					? 'MISS'
					: cacheEntry.isStale
					? 'STALE'
					: 'HIT',
			);
		}

		const {revalidate, value: cachedData} = cacheEntry;
		const revalidateOptions: any =
			typeof revalidate !== 'undefined' &&
			(!this.renderOpts.dev || (hasServerProps && !isDataRequest))
				? {
						// When the page is 404 cache-control should not be added unless
						// we are rendering the 404 page for notFound: true which should
						// cache according to revalidate correctly
						private: isPreviewMode || (is404Page && cachedData),
						stateful: !isSSG,
						revalidate,
				  }
				: undefined;

		if (!cachedData) {
			if (revalidateOptions) {
				setRevalidateHeaders(res, revalidateOptions);
			}

			if (isDataRequest) {
				res.statusCode = 404;
				res.body('{"notFound":true}').send();
				return undefined;
			}

			if (this.renderOpts.dev) {
				query.__nextNotFoundSrcPage = pathname;
			}

			await this.render404(
				req,
				res,
				{
					pathname,
					query,
				} as UrlWithParsedQuery,
				false,
			);
			return undefined;
		}

		if (cachedData.kind === 'REDIRECT') {
			if (revalidateOptions) {
				setRevalidateHeaders(res, revalidateOptions);
			}

			if (isDataRequest) {
				return {
					type: 'json',
					body: RenderResult.fromStatic(
						// @TODO: Handle flight data.
						JSON.stringify(cachedData.props),
					),
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					revalidateOptions,
				};
			}

			handleRedirect(cachedData.props);
			return undefined;
		}

		if (cachedData.kind === 'IMAGE') {
			throw new Error('invariant SSG should not return an image cache value');
		} else {
			return {
				type: isDataRequest ? (isAppPath ? 'rsc' : 'json') : 'html',
				body: isDataRequest
					? RenderResult.fromStatic(
							isAppPath
								? (cachedData.pageData as string)
								: JSON.stringify(cachedData.pageData),
					  )
					: cachedData.html,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				revalidateOptions,
			};
		}
	}

	private stripNextDataPath(path: string, stripLocale = true) {
		if (path.includes(this.manifestProvider.getBuildId())) {
			const splitPath = path.slice(
				Math.max(
					0,
					path.indexOf(this.manifestProvider.getBuildId()) +
						this.manifestProvider.getBuildId().length,
				),
			);

			path = denormalizePagePath(splitPath.replace(/\.json$/, ''));
		}

		if (this.nextConfig.i18n && stripLocale) {
			const {locales} = this.nextConfig.i18n;
			return normalizeLocalePath(path, locales).pathname;
		}

		return path;
	}

	// eslint-disable-next-line complexity
	private async renderToResponse(
		ctx: RequestContext,
	): Promise<ResponsePayload | undefined> {
		const {res, query, pathname} = ctx;
		let page = pathname;
		const bubbleNoFallback = Boolean(query._nextBubbleNoFallback);
		delete query._nextBubbleNoFallback;

		try {
			// Ensure a request to the URL /accounts/[id] will be treated as a dynamic
			// route correctly and not loaded immediately without parsing params.
			if (!isDynamicRoute(page)) {
				const result = await this.renderPageComponent(ctx, bubbleNoFallback);
				if (result !== false) return result;
			}

			if (this.dynamicRoutes) {
				for (const dynamicRoute of this.dynamicRoutes) {
					const parameters = dynamicRoute.match(pathname);
					if (!parameters) {
						continue;
					}

					page = dynamicRoute.page;
					// eslint-disable-next-line no-await-in-loop
					const result = await this.renderPageComponent(
						{
							...ctx,
							pathname: page,
							renderOpts: {
								...ctx.renderOpts,
								params: parameters,
							},
						},
						bubbleNoFallback,
					);
					if (result !== false) return result;
				}
			}
		} catch (error: unknown) {
			const error_ = getProperError(error);

			if (error instanceof MissingStaticPage) {
				console.error(
					'Invariant: failed to load static page',
					JSON.stringify(
						{
							page,
							url: ctx.req.url,
							matchedPath: ctx.req.headers['x-matched-path'],
							initUrl: getRequestMeta(ctx.req, '__NEXT_INIT_URL'),
							didRewrite: getRequestMeta(ctx.req, '_nextDidRewrite'),
							rewroteUrl: getRequestMeta(ctx.req, '_nextRewroteUrl'),
						},
						null,
						2,
					),
				);
				throw error_;
			}

			if (error_ instanceof NoFallbackError && bubbleNoFallback) {
				throw error_;
			}

			if (error_ instanceof DecodeError || error_ instanceof NormalizeError) {
				res.statusCode = 400;
				return this.renderErrorToResponse(ctx, error_);
			}

			res.statusCode = 500;

			// If pages/500 is present we still need to trigger
			// /_error `getInitialProps` to allow reporting error
			if (await this.pageChecker.hasPage('/500')) {
				ctx.query.__nextCustomErrorRender = '1';
				await this.renderErrorToResponse(ctx, error_);
				delete ctx.query.__nextCustomErrorRender;
			}

			const isWrappedError = error_ instanceof WrappedBuildError;

			if (!isWrappedError) {
				this.logger.logError(getProperError(error_));
			}

			const response = await this.renderErrorToResponse(
				ctx,
				isWrappedError ? error_.innerError : error_,
			);
			return response;
		}

		if (
			this.hasMiddleware &&
			Boolean(ctx.req.headers['x-nextjs-data']) &&
			(!res.statusCode || res.statusCode === 200 || res.statusCode === 404)
		) {
			res.setHeader(
				'x-nextjs-matched-path',
				`${query.__nextLocale ? `/${query.__nextLocale}` : ''}${pathname}`,
			);
			res.statusCode = 200;
			res.setHeader('content-type', 'application/json');
			res.body('{}');
			res.send();
			return undefined;
		}

		res.statusCode = 404;
		return this.renderErrorToResponse(ctx, undefined);
	}
}

export type IgnextRendererOptions =
	| RendererOptions & {
			loadComponent: (
				pathname: string,
			) => Promise<LoadComponentsReturnType | undefined>;
	  };

export class IgnextRenderer extends Renderer {
	private readonly loadComponent: (
		pathname: string,
	) => Promise<LoadComponentsReturnType | undefined>;

	constructor({loadComponent, ...options}: IgnextRendererOptions) {
		super(options);

		this.loadComponent = loadComponent;
	}

	protected async findPageComponents({
		pathname,
		query,
		params,
	}: {
		pathname: string;
		query: NextParsedUrlQuery;
		params: Params;
		isAppPath: boolean;
		appPaths?: string[] | undefined;
		sriEnabled?: boolean | undefined;
	}): Promise<FindComponentsResult | undefined> {
		const result = await this.loadComponent(pathname);
		if (!result) return undefined;

		return {
			query: {
				...query,
				...params,
			},
			components: result,
		};
	}

	protected async sendRenderResult(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: WebNextResponse,
		options: {
			result: RenderResult;
			type: 'html' | 'json' | 'rsc';
			generateEtags: boolean;
			poweredByHeader: boolean;
			options?: PayloadOptions | undefined;
		},
	): Promise<void> {
		res.setHeader('X-Edge-Runtime', '1');

		// Add necessary headers.
		// @TODO: Share the isomorphic logic with server/send-payload.ts.
		if (options.poweredByHeader && options.type === 'html') {
			res.setHeader('X-Powered-By', 'Next.js');
		}

		const resultContentType = options.result.contentType();

		if (!res.getHeader('Content-Type')) {
			res.setHeader(
				'Content-Type',
				resultContentType
					? resultContentType
					: options.type === 'json'
					? 'application/json'
					: 'text/html; charset=utf-8',
			);
		}

		if (options.result.isDynamic()) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
			const writer = res.transformStream.writable.getWriter();
			await options.result.pipe({
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
				write: (chunk: Uint8Array) => writer.write(chunk),
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
				end: () => writer.close(),
				// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
				_destroy: (error: Error) => writer.abort(error),
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				get destroy() {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-return
					return this._destroy;
				},
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				set destroy(value) {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					this._destroy = value;
				},
				// eslint-disable-next-line @typescript-eslint/no-empty-function
				cork() {},
				// eslint-disable-next-line @typescript-eslint/no-empty-function
				uncork() {},
				// Not implemented: on/removeListener
			} as any);
		} else {
			const payload = options.result.toUnchunkedString();
			res.setHeader('Content-Length', String(byteLength(payload)));
			if (options.generateEtags) {
				res.setHeader('ETag', generateETag(payload));
			}

			res.body(payload);
		}

		res.send();
	}

	protected async getFallback(page: string): Promise<string> {
		return '';
	}

	// eslint-disable-next-line max-params, @typescript-eslint/naming-convention
	protected async renderHTML(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: BaseNextResponse,
		pathname: string,
		query: NextParsedUrlQuery,
		renderOptions: RenderOpts,
	): Promise<RenderResult | undefined> {
		const renderFunction = renderOptions.isAppPath
			? renderToHTMLOrFlight
			: renderToHTML;

		return (
			(await renderFunction(
				{
					url: request.url,
					cookies: request.cookies,
					headers: request.headers,
				} as any,
				{} as any,
				pathname,
				query,
				Object.assign(renderOptions, {
					disableOptimizedLoading: true,
					runtime: 'experimental-edge',
				}),
			)) ?? undefined
		);
	}
}
