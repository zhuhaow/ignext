import type {AppType, DocumentType} from 'next/dist/shared/lib/utils';
import type {ReactLoadableManifest} from 'next/dist/server/load-components';
import type {BuildManifest} from 'next/dist/server/get-page-files';
import type {NextConfig} from 'next/dist/server/config-shared';
import type {FontLoaderManifest} from 'next/dist/build/webpack/plugins/font-loader-manifest-plugin';

// TODO: These can be imported conditionally based on whether there is
// page or app used.
import {renderToHTMLOrFlight} from 'next/dist/server/app-render';
import {renderToHTML} from 'next/dist/server/render';
import WebServer from 'next/dist/server/web-server';
import {WebNextRequest, WebNextResponse} from 'next/dist/server/base-http/web';
import {SERVER_RUNTIME} from 'next/dist/lib/constants';

type Options = ConstructorParameters<typeof WebServer>[0];

interface IgnextServerOptions extends Options {
	pages: string[];
}

class IgnextServer extends WebServer {
	pages: string[];

	constructor(options: IgnextServerOptions) {
		super(options);

		this.pages = options.pages;
		this.minimalMode = false;
	}

	protected async hasPage(page: string): Promise<boolean> {
		return this.pages.includes(page);
	}
}

interface PageRenderOptions {
	pageMod: any;
	isAppPath: boolean;
}

interface IgnextHandlerOptions {
	dev: boolean;
	config: NextConfig;
	buildManifest: BuildManifest;
	reactLoadableManifest: ReactLoadableManifest;
	subresourceIntegrityManifest?: Record<string, string>;
	fontLoaderManifest?: FontLoaderManifest;
	Document?: DocumentType;
	appMod: any;
	buildId: string;
	pagesOptions: Partial<Record<string, PageRenderOptions>>;
	serverComponentManifest: any;
	serverCSSManifest: any;
}

// Heavily borrowed from https://github.com/vercel/next.js/blob/canary/packages/next/build/webpack/loaders/next-edge-ssr-loader/render.ts
export function createIgnextHandler(options: IgnextHandlerOptions) {
	const server = new IgnextServer({
		dev: options.dev,
		conf: options.config,
		pages: Object.keys(options.pagesOptions),
		webServerConfig: {
			// We don't use this
			page: '',
			extendRenderOpts: {
				buildId: options.buildId,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				runtime: SERVER_RUNTIME.edge,
				// eslint-disable-next-line @typescript-eslint/naming-convention
				supportsDynamicHTML: true,
				disableOptimizedLoading: true,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				serverComponentManifest: options.serverComponentManifest,
				// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-assignment
				serverCSSManifest: options.serverCSSManifest,
			},
			// WebServer use the presence of `appRenderToHTML` or `pagesRenderToHTML` to
			// know which one to use. Clearly we have many `appRenderToHTML`s and `pagesRenderToHTML`s
			// we need to handle that ourselves. But we want to reuse the logic in `renderHTML` if
			// possible. So we wrap the logic in appRenderToHTML.
			//
			// eslint-disable-next-line max-params, @typescript-eslint/naming-convention
			async appRenderToHTML(
				request,
				response,
				pathname,
				query,
				renderOptions,
				_isPagesDir,
				_isStaticGeneration?: any,
			) {
				const pageOptions = options.pagesOptions[pathname];

				if (!pageOptions) {
					throw new Error(`Cannot find render for ${pathname}`);
				}

				if (pageOptions.isAppPath) {
					return renderToHTMLOrFlight(
						request,
						response,
						pathname,
						query,
						renderOptions,
						false,
					);
				}

				return renderToHTML(
					request,
					response,
					pathname,
					query,
					// The caller will call it with correct parameter
					renderOptions as any,
				);
			},
			async loadComponent(pathname) {
				const pageOptions = options.pagesOptions[pathname];

				if (!pageOptions) {
					throw new Error(`Cannot find render settings for ${pathname}`);
				}

				// Some fields should be optional but marked as required in Next.js.
				return {
					dev: options.dev,
					buildManifest: options.buildManifest,
					reactLoadableManifest: options.reactLoadableManifest,
					subresourceIntegrityManifest: options.subresourceIntegrityManifest,
					fontLoaderManifest: options.fontLoaderManifest,
					// eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-assignment
					Document: options.Document as any,
					// eslint-disable-next-line @typescript-eslint/naming-convention
					App: options.appMod?.default as AppType,
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/naming-convention
					Component: pageOptions.pageMod.default,
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					pageConfig: pageOptions.pageMod.config || {},
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					getStaticProps: pageOptions.pageMod.getStaticProps,
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					getServerSideProps: pageOptions.pageMod.getServerSideProps,
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					getStaticPaths: pageOptions.pageMod.getStaticPaths,
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/naming-convention
					ComponentMod: pageOptions.pageMod,
					pathname,
				};
			},
		},
	});

	const handler = server.getRequestHandler();

	// TODO: apply logic from `adapter.ts` here
	return async (request: Request) => {
		const extendedRequest = new WebNextRequest(request);
		const extendedResponse = new WebNextResponse();
		// Following what Next.js https://github.com/vercel/next.js/blob/canary/packages/next/build/webpack/loaders/next-edge-ssr-loader/render.ts
		// is doing
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		handler(extendedRequest, extendedResponse);
		return extendedResponse.toResponse();
	};
}
