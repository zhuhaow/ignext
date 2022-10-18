import {PrerenderManifest} from 'next/dist/build';
import {FontLoaderManifest} from 'next/dist/build/webpack/plugins/font-loader-manifest-plugin';
import {PagesManifest} from 'next/dist/build/webpack/plugins/pages-manifest-plugin';
import {FontManifest} from 'next/dist/server/font-utils';

export abstract class ManifestProvider {
	abstract getPrerenderManifest(): PrerenderManifest;

	abstract getPagesManifest(): PagesManifest | undefined;

	abstract getAppPathsManifest(): PagesManifest | undefined;

	abstract getRoutesManifest(): any;

	abstract getFontManifest(): FontManifest | undefined;

	abstract getServerComponentManifest(): any;

	// eslint-disable-next-line @typescript-eslint/naming-convention
	abstract getServerCSSManifest(): any;

	abstract getFontLoaderManifest(): FontLoaderManifest | undefined;

	abstract getBuildId(): string;
}

export class IgnextManifestProvider extends ManifestProvider {
	// eslint-disable-next-line max-params
	constructor(
		private readonly prerenderManifest: PrerenderManifest,
		private readonly serverComponentManifest: any,
		// eslint-disable-next-line @typescript-eslint/naming-convention
		private readonly serverCSSManifest: any,
		private readonly routesManifest: any,
		private readonly buildId: string,
		private readonly fontManifest?: FontManifest,
		private readonly fontLoaderManifest?: FontLoaderManifest,
		private readonly pagesManifest?: PagesManifest,
		private readonly appPathsManifest?: PagesManifest,
	) {
		super();
	}

	getPrerenderManifest(): PrerenderManifest {
		return this.prerenderManifest;
	}

	getPagesManifest(): PagesManifest | undefined {
		return this.pagesManifest;
	}

	getAppPathsManifest(): PagesManifest | undefined {
		return this.appPathsManifest;
	}

	getRoutesManifest(): any {
		return this.routesManifest;
	}

	getFontManifest(): FontManifest | undefined {
		return this.fontManifest;
	}

	getServerComponentManifest() {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return this.serverComponentManifest;
	}

	// eslint-disable-next-line @typescript-eslint/naming-convention
	getServerCSSManifest() {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return this.serverCSSManifest;
	}

	getFontLoaderManifest(): FontLoaderManifest | undefined {
		return this.fontLoaderManifest;
	}

	getBuildId(): string {
		return this.buildId;
	}
}
