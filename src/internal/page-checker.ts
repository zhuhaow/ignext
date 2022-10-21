import {PagesManifest} from 'next/dist/build/webpack/plugins/pages-manifest-plugin';
import {NextConfigComplete} from 'next/dist/server/config-shared';
import {normalizeLocalePath} from 'next/dist/shared/lib/i18n/normalize-locale-path';
import {denormalizePagePath} from 'next/dist/shared/lib/page-path/denormalize-page-path';
import {PageNotFoundError} from 'next/dist/shared/lib/utils';
import {normalizePagePath} from 'next/dist/shared/lib/page-path/normalize-page-path';
import {ManifestProvider} from './manifest-provider';

export abstract class PageChecker {
	public abstract hasPage(pathname: string): Promise<boolean>;
}

export class IgnextPageChecker extends PageChecker {
	constructor(
		private readonly manifestProvider: ManifestProvider,
		private readonly nextConfig: NextConfigComplete,
	) {
		super();
	}

	public async hasPage(pathname: string): Promise<boolean> {
		try {
			pathname = denormalizePagePath(normalizePagePath(pathname));
		} catch (error: unknown) {
			console.error(error);
			return false;
		}

		const checkManifest = (manifest: PagesManifest) => {
			let curPath = manifest[pathname];

			if (!manifest[curPath] && this.nextConfig.i18n?.locales) {
				const manifestNoLocales: PagesManifest = {};

				for (const key of Object.keys(manifest)) {
					manifestNoLocales[
						normalizeLocalePath(key, this.nextConfig.i18n?.locales).pathname
					] = this.manifestProvider.getPagesManifest()![key];
				}

				curPath = manifestNoLocales[pathname];
			}

			return curPath;
		};

		let pagePath: string | undefined;

		if (this.manifestProvider.getAppPathsManifest()) {
			pagePath = checkManifest(this.manifestProvider.getAppPathsManifest()!);
		}

		if (!pagePath) {
			pagePath = checkManifest(this.manifestProvider.getPagesManifest()!);
		}

		if (!pagePath) {
			return false;
		}

		return true;
	}
}
