/* eslint-disable unicorn/prefer-node-protocol */
import {parse as parseQs} from 'querystring';

// eslint-disable-next-line n/no-deprecated-api
import {format as formatUrl, parse as parseUrl, UrlWithParsedQuery} from 'url';
import {getProperError} from 'next/dist/lib/is-error';
import {CustomRoutes} from 'next/dist/lib/load-custom-routes';
import {getCookieParser, setLazyProp} from 'next/dist/server/api-utils';
import {BaseNextRequest, BaseNextResponse} from 'next/dist/server/base-http';
import {BaseRequestHandler, RoutingItem} from 'next/dist/server/base-server';
import {getClonableBody} from 'next/dist/server/body-streams';
import type {NextConfigComplete} from 'next/dist/server/config-shared';
import type {LoadComponentsReturnType} from 'next/dist/server/load-components';
import {
	addRequestMeta,
	getRequestMeta,
	NextUrlWithParsedQuery,
} from 'next/dist/server/request-meta';
import WebResponseCache from 'next/dist/server/response-cache/web';
import {TEMPORARY_REDIRECT_STATUS} from 'next/dist/shared/lib/constants';
import {getHostname} from 'next/dist/shared/lib/get-hostname';
import {detectDomainLocale} from 'next/dist/shared/lib/i18n/detect-domain-locale';
import {getLocaleRedirect} from 'next/dist/shared/lib/i18n/get-locale-redirect';
import {normalizeLocalePath} from 'next/dist/shared/lib/i18n/normalize-locale-path';
import {
	getSortedRoutes,
	isDynamicRoute,
} from 'next/dist/shared/lib/router/utils';
import {
	normalizeAppPath,
	normalizeRscPath,
} from 'next/dist/shared/lib/router/utils/app-paths';
import {getNextPathnameInfo} from 'next/dist/shared/lib/router/utils/get-next-pathname-info';
import {parseUrl as parseUrlUtil} from 'next/dist/shared/lib/router/utils/parse-url';
import {removePathPrefix} from 'next/dist/shared/lib/router/utils/remove-path-prefix';
import {getRouteMatcher} from 'next/dist/shared/lib/router/utils/route-matcher';
import {getRouteRegex} from 'next/dist/shared/lib/router/utils/route-regex';
import {
	DecodeError,
	NormalizeError,
	normalizeRepeatedSlashes,
} from 'next/dist/shared/lib/utils';
import {ConsoleLogger, Logger} from './logger';
import {ManifestProvider} from './manifest-provider';
import {IgnextPageChecker} from './page-checker';
import {IgnextRenderer, Renderer} from './renderer';
import {IgnextRouterBuilder, RouterBuilder} from './router-builder';

interface WebServerOptions {
	manifestProvider: ManifestProvider;
	nextConfig: NextConfigComplete;
	loadComponent: (
		pathname: string,
	) => Promise<LoadComponentsReturnType | undefined>;
}

export class IgnextServer {
	manifestProvider: ManifestProvider;
	renderer: Renderer;
	routeBuilder: RouterBuilder;
	logger: Logger;
	hasAppDir: boolean;
	nextConfig: NextConfigComplete;

	constructor(options: WebServerOptions) {
		this.manifestProvider = options.manifestProvider;
		this.nextConfig = options.nextConfig;

		this.logger = new ConsoleLogger(false);
		this.hasAppDir = Boolean(this.manifestProvider.getAppPathsManifest());

		const dynamicRoutes = this.getDynamicRoutes();
		const pageChecker = new IgnextPageChecker(
			this.manifestProvider,
			this.nextConfig,
		);

		this.renderer = new IgnextRenderer({
			nextConfig: this.nextConfig,
			manifestProvider: this.manifestProvider,
			responseCache: new WebResponseCache(true),
			logger: this.logger,
			hasMiddleware: Boolean(
				this.manifestProvider.getMiddlewareManifest()?.middleware?.['/'],
			),
			renderOpts: {
				poweredByHeader: this.nextConfig.poweredByHeader,
				canonicalBase: this.nextConfig.amp?.canonicalBase ?? '',
				buildId: this.manifestProvider.getBuildId(),
				generateEtags: this.nextConfig.generateEtags,
				previewProps: this.manifestProvider.getPrerenderManifest().preview,
				customServer: false,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				ampOptimizerConfig: this.nextConfig.experimental.amp?.optimizer,
				basePath: this.nextConfig.basePath,
				images: this.nextConfig.images,
				optimizeFonts: this.nextConfig.optimizeFonts,
				fontManifest: this.nextConfig.optimizeFonts
					? this.manifestProvider.getFontManifest()
					: undefined,
				optimizeCss: this.nextConfig.experimental.optimizeCss,
				nextScriptWorkers: this.nextConfig.experimental.nextScriptWorkers,
				disableOptimizedLoading: this.nextConfig.experimental.runtime
					? true
					: this.nextConfig.experimental.disableOptimizedLoading,
				domainLocales: this.nextConfig.i18n?.domains,
				distDir: '',
				runtime: this.nextConfig.experimental.runtime,
				serverComponents: this.hasAppDir,
				crossOrigin: this.nextConfig.crossOrigin
					? this.nextConfig.crossOrigin
					: undefined,
				largePageDataBytes: this.nextConfig.experimental.largePageDataBytes,
			},
			dynamicRoutes,
			pageChecker,
			loadComponent: options.loadComponent,
		});

		this.routeBuilder = new IgnextRouterBuilder(
			this.manifestProvider,
			this.nextConfig,
			this.renderer,
			this.getCustomRoutes(),
			dynamicRoutes,
			pageChecker,
		);
	}

	public getRequestHandler(): BaseRequestHandler {
		return this.handleRequest.bind(this);
	}

	private getCustomRoutes(): CustomRoutes {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const customRoutes = this.manifestProvider.getRoutesManifest();
		let rewrites: CustomRoutes['rewrites'];

		// Rewrites can be stored as an array when an array is
		// returned in next.config.js so massage them into
		// the expected object format
		if (Array.isArray(customRoutes.rewrites)) {
			rewrites = {
				beforeFiles: [],
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				afterFiles: customRoutes.rewrites,
				fallback: [],
			};
		} else {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			rewrites = customRoutes.rewrites;
		}

		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return Object.assign(customRoutes, {rewrites});
	}

	private getDynamicRoutes(): RoutingItem[] {
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

		const addedPages = new Set<string>();

		return (
			getSortedRoutes(
				[
					...Object.keys(appPathRoutes),
					...Object.keys(this.manifestProvider.getPagesManifest()!),
				].map(
					(page) =>
						normalizeLocalePath(page, this.nextConfig.i18n?.locales).pathname,
				),
			)
				.map((page) => {
					if (addedPages.has(page) || !isDynamicRoute(page)) return null;
					addedPages.add(page);
					return {
						page,
						match: getRouteMatcher(getRouteRegex(page)),
					};
				})
				// eslint-disable-next-line unicorn/prefer-native-coercion-functions
				.filter((item): item is RoutingItem => Boolean(item))
		);
	}

	// eslint-disable-next-line complexity
	private async handleRequest(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: BaseNextResponse,
		parsedUrl?: NextUrlWithParsedQuery,
	): Promise<void> {
		try {
			// Ensure cookies set in middleware are merged and
			// not overridden by API routes/getServerSideProps
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, unicorn/prevent-abbreviations
			const _res = (res as any).originalResponse || res;
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
			const origSetHeader = _res.setHeader.bind(_res);

			_res.setHeader = (name: string, value: string | string[]) => {
				if (name.toLowerCase() === 'set-cookie') {
					const middlewareValue = getRequestMeta(
						request,
						'_nextMiddlewareCookie',
					);

					if (
						!middlewareValue ||
						!Array.isArray(value) ||
						!value.every((item, idx) => item === middlewareValue[idx])
					) {
						value = [
							...(middlewareValue ?? []),
							...(typeof value === 'string'
								? [value]
								: Array.isArray(value)
								? value
								: []),
						];
					}
				}

				// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
				return origSetHeader(name, value);
			};

			const urlParts = (request.url || '').split('?');
			const urlNoQuery = urlParts[0];

			// This normalizes repeated slashes in the path e.g. hello//world ->
			// hello/world or backslashes to forward slashes, this does not
			// handle trailing slash as that is handled the same as a next.config.js
			// redirect
			if (/(\\|\/\/)/.test(urlNoQuery)) {
				const cleanUrl = normalizeRepeatedSlashes(request.url);
				res.redirect(cleanUrl, 308).body(cleanUrl).send();
				return;
			}

			setLazyProp(
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				{req: request as any},
				'cookies',
				getCookieParser(request.headers),
			);

			// Parse url if parsedUrl not provided
			if (!parsedUrl || typeof parsedUrl !== 'object') {
				parsedUrl = parseUrl(request.url, true);
			}

			// Parse the querystring ourselves if the user doesn't handle querystring parsing
			if (typeof parsedUrl.query === 'string') {
				parsedUrl.query = parseQs(parsedUrl.query);
			}

			request.url = normalizeRscPath(request.url, this.hasAppDir);
			parsedUrl.pathname = normalizeRscPath(
				parsedUrl.pathname ?? '',
				this.hasAppDir,
			);

			this.attachRequestMeta(request, parsedUrl);

			const domainLocale = detectDomainLocale(
				this.nextConfig.i18n?.domains,
				getHostname(parsedUrl, request.headers),
			);

			const defaultLocale =
				domainLocale?.defaultLocale ?? this.nextConfig.i18n?.defaultLocale;

			const url = parseUrlUtil(request.url.replace(/^\/+/, '/'));
			const pathnameInfo = getNextPathnameInfo(url.pathname, {
				nextConfig: this.nextConfig,
			});

			url.pathname = pathnameInfo.pathname;

			if (pathnameInfo.basePath) {
				request.url = removePathPrefix(
					request.url,
					this.nextConfig.basePath ?? '',
				);
				addRequestMeta(request, '_nextHadBasePath', true);
			}

			addRequestMeta(
				request,
				'__nextHadTrailingSlash',
				pathnameInfo.trailingSlash,
			);
			addRequestMeta(request, '__nextIsLocaleDomain', Boolean(domainLocale));

			parsedUrl.query.__nextDefaultLocale = defaultLocale;

			if (pathnameInfo.locale) {
				request.url = formatUrl(url);
				addRequestMeta(request, '__nextStrippedLocale', true);
			}

			if (
				!parsedUrl.query.__nextLocale &&
				(pathnameInfo.locale || defaultLocale)
			) {
				parsedUrl.query.__nextLocale = pathnameInfo.locale ?? defaultLocale;
			}

			if (defaultLocale) {
				const redirect = getLocaleRedirect({
					defaultLocale,
					domainLocale,
					headers: request.headers,
					nextConfig: this.nextConfig,
					pathLocale: pathnameInfo.locale,
					urlParsed: {
						...url,
						pathname: pathnameInfo.locale
							? `/${pathnameInfo.locale}${url.pathname}`
							: url.pathname,
					},
				});

				if (redirect) {
					res
						.redirect(redirect, TEMPORARY_REDIRECT_STATUS)
						.body(redirect)
						.send();
					return;
				}
			}

			res.statusCode = 200;
			await this.run(request, res, parsedUrl);
			return;
		} catch (error: unknown) {
			if (
				(error &&
					typeof error === 'object' &&
					(error as any).code === 'ERR_INVALID_URL') ||
				error instanceof DecodeError ||
				error instanceof NormalizeError
			) {
				res.statusCode = 400;
				return this.renderer.renderError(
					undefined,
					request,
					res,
					'/_error',
					{},
				);
			}

			this.logger.logError(getProperError(error));
			res.statusCode = 500;
			res.body('Internal Server Error').send();
		}
	}

	private async run(
		request: BaseNextRequest,
		// eslint-disable-next-line unicorn/prevent-abbreviations
		res: BaseNextResponse,
		parsedUrl: UrlWithParsedQuery,
	): Promise<void> {
		try {
			const matched = await this.routeBuilder
				.getRouter()
				.execute(request, res, parsedUrl);
			if (matched) {
				return;
			}
		} catch (error: unknown) {
			if (error instanceof DecodeError || error instanceof NormalizeError) {
				res.statusCode = 400;
				return this.renderer.renderError(
					undefined,
					request,
					res,
					'/_error',
					{},
				);
			}

			throw error;
		}

		await this.renderer.render404(request, res, parsedUrl);
	}

	private attachRequestMeta(
		request: BaseNextRequest,
		parsedUrl: NextUrlWithParsedQuery,
	) {
		// When there are hostname and port we build an absolute URL
		const initUrl = request.url;

		addRequestMeta(request, '__NEXT_INIT_URL', initUrl);
		addRequestMeta(request, '__NEXT_INIT_QUERY', {...parsedUrl.query});
		addRequestMeta(request, '_protocol', 'https');
		addRequestMeta(
			request,
			'__NEXT_CLONABLE_BODY',
			getClonableBody(request.body),
		);
	}
}
