import {WebNextRequest, WebNextResponse} from 'next/dist/server/base-http/web';
import {NextConfigComplete} from 'next/dist/server/config-shared';
import {AppType, DocumentType} from 'next/dist/shared/lib/utils';
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
}

export function adapter(options: IgnextHandlerOptions) {
	const manifestProvider = new IgnextManifestProvider(options.manifestOptions);

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
	});

	const handler = server.getRequestHandler();

	return async ({request}: {request: Request}) => {
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
	Object.assign(request, {
		ip: request.headers.get('CF-Connecting-IP') ?? undefined,
		geo: {
			country: request.cf?.country,
			city: request.cf?.city,
			region: request.cf?.region,
			latitude: request.cf?.latitude,
			longitude: request.cf?.longitude,
		},
		nextConfig,
	});
}
