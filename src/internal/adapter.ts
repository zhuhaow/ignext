import {WebNextRequest, WebNextResponse} from 'next/dist/server/base-http/web';
import {NextConfigComplete} from 'next/dist/server/config-shared';
import {AppType, DocumentType} from 'next/dist/shared/lib/utils';
import {NextMiddleware} from 'next/server';
import {
	IgnextManifestProvider,
	IgnextManifestProviderOptions,
} from './manifest-provider';
import {IgnextServer} from './server';

interface PageRenderOptions {
	pageMod: any;
	isAppPath: boolean;
}

interface IgnextHandlerOptions {
	dev: boolean;
	config: NextConfigComplete;
	manifestOptions: IgnextManifestProviderOptions;
	Document?: DocumentType;
	appMod: any;
	pagesOptions: Partial<Record<string, PageRenderOptions>>;
	functionOptions: Partial<Record<string, NextMiddleware>>;
}

export function adapter(options: IgnextHandlerOptions) {
	return async ({
		request,
		env,
	}: EventContext<Record<string, unknown>, string, any>) => {
		const manifestProvider = new IgnextManifestProvider(
			options.manifestOptions,
		);

		const server = new IgnextServer({
			manifestProvider,
			nextConfig: options.config,
			async loadComponent(pathname) {
				const pageOptions = options.pagesOptions[pathname];

				if (!pageOptions) {
					return undefined;
				}

				// Some fields should be optional but marked as required in Next.js.
				return {
					dev: options.dev,
					buildManifest: options.manifestOptions.buildManifest,
					reactLoadableManifest: options.manifestOptions.reactLoadableManifest,
					subresourceIntegrityManifest:
						options.manifestOptions.subresourceIntegrityManifest,
					fontLoaderManifest: options.manifestOptions.fontLoaderManifest,
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
			async loadFunction(pathname: string) {
				return options.functionOptions[pathname];
			},
			env,
		});

		const handler = server.getRequestHandler();

		transformRequest(request, options.config);
		const extendedRequest = new WebNextRequest(request);
		const extendedResponse = new WebNextResponse();
		// Following what Next.js https://github.com/vercel/next.js/blob/canary/packages/next/build/webpack/loaders/next-edge-ssr-loader/render.ts
		// is doing
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		handler(extendedRequest, extendedResponse);
		return extendedResponse.toResponse();
	};
}

// From https://developers.cloudflare.com/fundamentals/get-started/reference/http-request-headers/
// and https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties
function transformRequest(request: Request, nextConfig: NextConfigComplete) {
	const {cf} = request;
	const geo =
		cf && 'country' in cf && cf.country !== 'T1'
			? {
					country: cf.country,
					city: cf.city,
					region: cf.region,
					latitude: cf.latitude,
					longitude: cf.longitude,
			  }
			: {};

	Object.assign(request, {
		ip: request.headers.get('CF-Connecting-IP') ?? undefined,
		geo,
		nextConfig,
	});
}
