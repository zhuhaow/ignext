/* eslint-disable unicorn/prefer-node-protocol */
import {Buffer} from 'buffer';
import path from 'path';
import {parse} from 'querystring';
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
	import {adapter} from "${path.resolve(__dirname, '../internal/adapter')}"

	const handlerOptions = ${buildHandlerOptions.call(this, options as any)};

	function createOnRequestHandler(manifestOptions) {
		return adapter({...handlerOptions, manifestOptions})
	}

	export {createOnRequestHandler};
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
		absoluteDocumentPath,
		absoluteAppPath,
		absolute500Path,
		absoluteErrorPath,
	} = loaderOptions.pageQueries[0];

	const stringifyPath = (path?: string) => {
		return path
			? stringifyRequest(this, swapDistFolderWithEsmDistFolder(path))
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

	for (const value of loaderOptions.pageQueries) {
		const appDirLoaderString = Buffer.from(
			value.appDirLoader ?? '',
			'base64',
		).toString();
		const stringifiedPagePath = stringifyPath(value.absolutePagePath)!;
		const pageModPath = `${appDirLoaderString}${stringifiedPagePath.slice(
			1,
			-1,
		)}`;
		pageConfigs[value.page] = `require(${JSON.stringify(pageModPath)})`;
	}

	return `
		{
			dev: ${JSON.stringify(dev)},
			config: ${stringifiedConfig},
			Document: ${
				stringifiedDocumentPath
					? `require(${stringifiedDocumentPath}).default`
					: 'undefined'
			},
			appMod: ${stringifiedAppPath ? `require(${stringifiedAppPath})` : 'undefined'},
			pagesOptions: {${Object.entries(pageConfigs)
				.map(([k, v]) => `"${k}": ${v}`)
				.join(',')}},
		}
	`;
}
