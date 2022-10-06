/* eslint-disable unicorn/prefer-node-protocol */
import {parse} from 'querystring';
import {Buffer} from 'buffer';
import path from 'path';
import type {LoaderContext} from 'webpack';
import type {EdgeSSRLoaderQuery} from 'next/dist/build/webpack/loaders/next-edge-ssr-loader';
import type {EdgeFunctionLoaderOptions} from 'next/dist/build/webpack/loaders/next-edge-function-loader';
import type {MiddlewareLoaderOptions} from 'next/dist/build/webpack/loaders/next-middleware-loader';
import {stringifyRequest} from 'next/dist/build/webpack/stringify-request';
import toArray from 'lodash-es/toArray';

export interface Options {
	pageQueries?: string[];
	functionQueries?: string[];
	middlewareQuery?: string;
}

interface ParsedOptions {
	pageQueries: EdgeSSRLoaderQuery[];
	functionQueries: EdgeFunctionLoaderOptions[];
	middlewareQuery?: MiddlewareLoaderOptions;
}

export default function ignextServerLoader(this: LoaderContext<Options>) {
	const {pageQueries, functionQueries, middlewareQuery} = this.getOptions();

	const options = {
		pageQueries: toArray(pageQueries).map((q) => parse(q)),
		functionQueries: toArray(functionQueries).map((q) => parse(q)),
		middlewareQuery: middlewareQuery ? parse(middlewareQuery) : undefined,
	};

	return `
	import {createIgnextHandler} from "${path.resolve(
		__dirname,
		'../internal/server',
	)}"
	
	const handlerOptions = ${buildHandlerOptions.call(this, options as any)};

	export const onRequest = createIgnextHandler(handlerOptions);
	`;
}

function swapDistFolderWithEsmDistFolder(path: string) {
	return path.replace('next/dist/pages', 'next/dist/esm/pages');
}

function buildHandlerOptions(
	this: LoaderContext<Options>,
	loaderOptions: ParsedOptions,
) {
	if (loaderOptions.pageQueries.length === 0) {
		throw new Error('No page found');
	}

	// All these configs are the same for all
	// entrypoints
	const {
		dev,
		stringifiedConfig,
		sriEnabled,
		hasFontLoaders,
		absoluteDocumentPath,
		absoluteAppPath,
		absolute500Path,
		absoluteErrorPath,
		buildId,
	} = loaderOptions.pageQueries[0];

	const hasServerComponent = loaderOptions.pageQueries.some(
		(q) => q.pagesType === 'app',
	);

	const stringifyPath = (path?: string) => {
		return path
			? stringifyRequest(this, swapDistFolderWithEsmDistFolder(absoluteAppPath))
			: undefined;
	};

	const stringifiedAppPath = stringifyPath(absoluteAppPath);
	const stringifiedErrorPath = stringifyPath(absoluteErrorPath);
	const stringifiedDocumentPath = stringifyPath(absoluteDocumentPath);
	const stringified500Path = stringifyPath(absolute500Path);

	const pageConfigs: Record<string, string> = {};

	if (stringifiedErrorPath) {
		pageConfigs['/_error'] = `require(${stringifiedErrorPath})`;
	}

	if (stringified500Path) {
		pageConfigs['/500'] = `require(${stringified500Path})`;
	}

	for (const [key, value] of Object.entries(loaderOptions.pageQueries)) {
		const appDirLoaderString = Buffer.from(
			value.appDirLoader ?? '',
			'base64',
		).toString();
		const stringifiedPagePath = stringifyPath(value.absolutePagePath)!;
		const pageModPath = `${appDirLoaderString}${stringifiedPagePath.slice(
			1,
			-1,
		)}`;
		pageConfigs[key] = `require(${JSON.stringify(pageModPath)})`;
	}

	return `
		{
			dev: ${JSON.stringify(dev)},
			config: ${stringifiedConfig},
			buildManifest: self.__BUILD_MANIFEST,
			reactLoadableManifest: self.__REACT_LOADABLE_MANIFEST,
			subresourceIntegrityManifest: ${
				sriEnabled ? 'self.__SUBRESOURCE_INTEGRITY_MANIFEST' : 'undefined'
			},
			fontLoaderManifest: ${
				hasFontLoaders ? 'self.__FONT_LOADER_MANIFEST' : 'undefined'
			},
			Document: ${
				stringifiedDocumentPath
					? `require(${stringifiedDocumentPath}).default`
					: 'undefined'
			},
			appMod: ${stringifiedAppPath ? `require(${stringifiedAppPath})` : 'undefined'},
			buildId: ${JSON.stringify(buildId)},
			pagesOptions: ${JSON.stringify(pageConfigs)},
			serverComponentManifest: ${
				hasServerComponent ? 'self.__RSC_MANIFEST' : 'undefined'
			},
			serverCSSManifest: ${
				hasServerComponent ? 'self.__RSC_CSS_MANIFEST' : 'undefined'
			}
		}
	`;
}
