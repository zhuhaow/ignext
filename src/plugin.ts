// eslint-disable-next-line unicorn/prefer-node-protocol
import path from 'path';
import {stringify} from 'node:querystring';
import type {NextConfig} from 'next';
import {COMPILER_NAMES} from 'next/dist/shared/lib/constants';
import {Compiler, Configuration, DefinePlugin} from 'webpack';
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
		compiler.hooks.entryOption.tap('IgnextPlugin', (_context, entry) => {
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

			entry['ignext/[[path]]'] = {
				import: [`ignext-server-loader?${stringify({...serverQuery})}!`],
				library: {
					type: 'module',
				},
				asyncChunks: false,
				chunkLoading: false,
			};

			return undefined as unknown as boolean;
		});
	}
}
