import path from 'node:path';
import {stringify} from 'node:querystring';
import type {NextConfig} from 'next';
import {
	APP_PATHS_MANIFEST,
	COMPILER_NAMES,
	FLIGHT_MANIFEST,
	FLIGHT_SERVER_CSS_MANIFEST,
	FONT_LOADER_MANIFEST,
	FONT_MANIFEST,
	MIDDLEWARE_BUILD_MANIFEST,
	MIDDLEWARE_MANIFEST,
	MIDDLEWARE_REACT_LOADABLE_MANIFEST,
	PAGES_MANIFEST,
	PRERENDER_MANIFEST,
	ROUTES_MANIFEST,
	SUBRESOURCE_INTEGRITY_MANIFEST,
} from 'next/dist/shared/lib/constants';
import {Compiler, Configuration, DefinePlugin, sources} from 'webpack';
import {WEBPACK_LAYERS} from 'next/dist/lib/constants';
import {Options} from './loaders/ignext-server-loader';

export function withIgnext(nextConfig: NextConfig): NextConfig {
	const oldWebpackWrapper = nextConfig.webpack;

	return {
		...nextConfig,
		webpack(config, context) {
			updateEdgeWebpackConfig(oldWebpackWrapper?.(config, context) ?? config);
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return config;
		},
	};
}

function updateEdgeWebpackConfig(config: Configuration) {
	if (
		config.name !== COMPILER_NAMES.edgeServer ||
		config.mode === 'development'
	) {
		return;
	}

	config.plugins = config.plugins ?? [];
	config.plugins.push(
		new IgnextPlugin(),
		new DefinePlugin({
			// eslint-disable-next-line @typescript-eslint/naming-convention
			'process.env.NEXT_PRIVATE_MINIMAL_MODE': JSON.stringify('0'),
			// eslint-disable-next-line @typescript-eslint/naming-convention
			'process.env.NODE_DEBUG': JSON.stringify('0'),
		}),
	);

	// It's a map
	(config.resolveLoader!.alias! as any)['ignext-server-loader'] = path.resolve(
		__dirname,
		'loaders/ignext-server-loader',
	);

	config.optimization = {
		...config.optimization,
		splitChunks: false,
		minimize: false,
	};

	config.output = {
		...config.output,
		enabledLibraryTypes: [
			...(config.output?.enabledLibraryTypes ?? []),
			'module',
		],
	};
	config.experiments = {
		...config.experiments,
		outputModule: true,
	};
}

class IgnextPlugin {
	apply(compiler: Compiler) {
		compiler.hooks.entryOption.tap(this.constructor.name, (_context, entry) => {
			if (typeof entry !== 'object') {
				throw new TypeError(
					'Failed to get entry information since entry is not a static object',
				);
			}

			const imports = Object.values(entry).flatMap((c) => {
				return c.import ?? [];
			});
			const serverQuery: Options = {pageQueries: [], functionQueries: []};
			const pattern = /([^?]+)\?(.+)!$/;
			for (const im of imports) {
				const match = pattern.exec(im);
				if (!match || !match[1] || !match[2]) {
					throw new Error(`Invalid loader ${im} query`);
				}

				switch (match[1]) {
					case 'next-edge-ssr-loader': {
						serverQuery.pageQueries!.push(match[2]);
						break;
					}

					case 'next-edge-function-loader': {
						serverQuery.functionQueries!.push(match[2]);
						break;
					}

					case 'next-middleware-loader': {
						serverQuery.middlewareQuery = match[2];
						break;
					}

					default: {
						throw new Error(`Unsupported Next.js loader ${match[1]}`);
					}
				}
			}

			entry['.ignext/handler'] = {
				import: [`ignext-server-loader?${stringify({...serverQuery})}!`],
				library: {
					type: 'module',
				},
				asyncChunks: false,
				chunkLoading: false,
			};

			return undefined as unknown as boolean;
		});

		// Compiler.hooks.thisCompilation.tap(this.constructor.name, (compilation) => {
		// 	compilation.hooks.processAssets.tap(
		// 		{
		// 			name: this.constructor.name,
		// 			// Ideally, we should use PROCESS_ASSETS_STAGE_ADDITIONS to add
		// 			// this meta information. But Next.js generate this information
		// 			// in PROCESS_ASSETS_STAGE_ADDITIONS stage while it should use
		// 			// PROCESS_ASSETS_STAGE_DERIVED.
		// 			// TODO: Fix this at Next.js side.
		// 			stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
		// 		},
		// 		(assets) => {
		// 			function findAsset(
		// 				name: string,
		// 			): [string, sources.Source] | undefined {
		// 				console.log(assets);
		// 				return Object.entries(assets).find(([k]) => {
		// 					return k.includes(name);
		// 				});
		// 			}

		// 			function loadAsset(
		// 				name: string,
		// 				required: boolean,
		// 				variable?: string,
		// 			): sources.Source {
		// 				const result = findAsset(name);
		// 				if (!result) {
		// 					if (required) {
		// 						compilation.errors.push(
		// 							new compiler.webpack.WebpackError(
		// 								`Failed to get asset ${name}`,
		// 							),
		// 						);
		// 					}

		// 					return new sources.RawSource('');
		// 				}

		// 				if (variable) {
		// 					return new sources.ConcatSource(
		// 						`self.${variable}=`,
		// 						result[1],
		// 						'\n',
		// 					);
		// 				}

		// 				return result[1];
		// 			}

		// 			const [serverName, serverSource] = findAsset('.ignext/handler')!;
		// 			const reactLoadableManifestSource = loadAsset(
		// 				MIDDLEWARE_REACT_LOADABLE_MANIFEST + '.js',
		// 				false,
		// 			);
		// 			const buildManifestSource = loadAsset(
		// 				MIDDLEWARE_BUILD_MANIFEST + '.js',
		// 				false,
		// 			);
		// 			const subresourceIntegrityManifestSource = loadAsset(
		// 				SUBRESOURCE_INTEGRITY_MANIFEST + '.js',
		// 				false,
		// 			);
		// 			const fontLoaderManifestSource = loadAsset(
		// 				FONT_LOADER_MANIFEST + '.js',
		// 				false,
		// 			);
		// 			const serverComponentManifestSource = loadAsset(
		// 				FLIGHT_MANIFEST + '.js',
		// 				false,
		// 			);
		// 			// eslint-disable-next-line @typescript-eslint/naming-convention
		// 			const serverCSSManifestSource = loadAsset(
		// 				FLIGHT_SERVER_CSS_MANIFEST + '.js',
		// 				false,
		// 			);
		// 			const prerenderManifestSource = loadAsset(
		// 				PRERENDER_MANIFEST,
		// 				false,
		// 				'__PRERENDER_MANIFEST',
		// 			);
		// 			const pagesManifestSource = loadAsset(
		// 				PAGES_MANIFEST,
		// 				false,
		// 				'__PAGES_MANIFEST',
		// 			);
		// 			const appPathsManifestSource = loadAsset(
		// 				APP_PATHS_MANIFEST,
		// 				false,
		// 				'__APP_PATHS_MANIFEST',
		// 			);
		// 			const routesManifestSource = loadAsset(
		// 				ROUTES_MANIFEST,
		// 				false,
		// 				'__ROUTES_MANIFEST',
		// 			);
		// 			const fontManifestSource = loadAsset(
		// 				FONT_MANIFEST,
		// 				false,
		// 				'__FONT_MANIFEST',
		// 			);
		// 			const middlewareManifestSource = loadAsset(
		// 				MIDDLEWARE_MANIFEST,
		// 				false,
		// 				'__MIDDLEWARE_MANIFEST',
		// 			);

		// 			compilation.updateAsset(
		// 				serverName,
		// 				new sources.ConcatSource(
		// 					reactLoadableManifestSource,
		// 					buildManifestSource,
		// 					subresourceIntegrityManifestSource,
		// 					fontLoaderManifestSource,
		// 					serverComponentManifestSource,
		// 					serverCSSManifestSource,
		// 					prerenderManifestSource,
		// 					pagesManifestSource,
		// 					appPathsManifestSource,
		// 					routesManifestSource,
		// 					fontManifestSource,
		// 					middlewareManifestSource,
		// 					serverSource,
		// 				),
		// 			);
		// 		},
		// 	);
		// });
	}
}
