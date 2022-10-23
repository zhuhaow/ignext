import {PrerenderManifest} from 'next/dist/build';
import {FontLoaderManifest} from 'next/dist/build/webpack/plugins/font-loader-manifest-plugin';
import {MiddlewareManifest} from 'next/dist/build/webpack/plugins/middleware-plugin';
import {PagesManifest} from 'next/dist/build/webpack/plugins/pages-manifest-plugin';
import {FontManifest} from 'next/dist/server/font-utils';
import {BuildManifest} from 'next/dist/server/get-page-files';
import {ReactLoadableManifest} from 'next/dist/server/load-components';

export abstract class ManifestProvider {
	abstract getPrerenderManifest(): PrerenderManifest;

	abstract getPagesManifest(): PagesManifest;

	abstract getAppPathsManifest(): PagesManifest | undefined;

	abstract getRoutesManifest(): any;

	abstract getFontManifest(): FontManifest;

	abstract getServerComponentManifest(): any;

	// eslint-disable-next-line @typescript-eslint/naming-convention
	abstract getServerCSSManifest(): any;

	abstract getFontLoaderManifest(): FontLoaderManifest | undefined;

	abstract getBuildId(): string;

	abstract getMiddlewareManifest(): MiddlewareManifest | undefined;
}

export interface IgnextManifestProviderOptions {
	prerenderManifest: PrerenderManifest;
	serverComponentManifest: any;
	serverCSSManifest: any;
	routesManifest: any;
	buildId: string;
	pagesManifest: PagesManifest;
	fontManifest: FontManifest;
	fontLoaderManifest?: FontLoaderManifest;
	appPathsManifest?: PagesManifest;
	middlewareManefest?: MiddlewareManifest;
	buildManifest: BuildManifest;
	reactLoadableManifest: ReactLoadableManifest;
	subresourceIntegrityManifest?: Record<string, string>;
}

export class IgnextManifestProvider extends ManifestProvider {
	private readonly options: IgnextManifestProviderOptions;
	constructor(options: IgnextManifestProviderOptions) {
		super();
		this.options = options;
	}

	getPrerenderManifest(): PrerenderManifest {
		return this.options.prerenderManifest;
	}

	getPagesManifest(): PagesManifest {
		return this.options.pagesManifest;
	}

	getAppPathsManifest(): PagesManifest | undefined {
		return this.options.appPathsManifest;
	}

	getRoutesManifest(): any {
		return this.options.routesManifest;
	}

	getFontManifest(): FontManifest {
		return this.options.fontManifest;
	}

	getServerComponentManifest() {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return this.options.serverComponentManifest;
	}

	// eslint-disable-next-line @typescript-eslint/naming-convention
	getServerCSSManifest() {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return this.options.serverCSSManifest;
	}

	getFontLoaderManifest(): FontLoaderManifest | undefined {
		return this.options.fontLoaderManifest;
	}

	getBuildId(): string {
		return this.options.buildId;
	}

	getMiddlewareManifest(): MiddlewareManifest | undefined {
		return this.options.middlewareManefest;
	}
}
