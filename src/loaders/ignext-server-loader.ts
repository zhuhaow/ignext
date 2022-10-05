/* eslint-disable unicorn/prefer-node-protocol */
import {parse, stringify} from 'querystring';
import {Buffer} from 'buffer';
import type {LoaderContext} from 'webpack';
import type {EdgeSSRLoaderQuery} from 'next/dist/build/webpack/loaders/next-edge-ssr-loader';
import type {EdgeFunctionLoaderOptions} from 'next/dist/build/webpack/loaders/next-edge-function-loader';
import type {MiddlewareLoaderOptions} from 'next/dist/build/webpack/loaders/next-middleware-loader';
import {getModuleBuildInfo} from 'next/dist/build/webpack/loaders/get-module-build-info';
import {stringifyRequest} from 'next/dist/build/webpack/stringify-request';

export interface Options {
	pageQueries: string[];
	functionQueries: string[];
	middlewareQuery?: string;
}

interface ParsedOptions {
	pageQueries: EdgeSSRLoaderQuery[];
	functionQuries: EdgeFunctionLoaderOptions[];
	middlewareQueries: MiddlewareLoaderOptions;
}

export default function ignextServerLoader(this: LoaderContext<Options>) {
	const {pageQueries, functionQueries, middlewareQuery} = this.getOptions();

	const options = {
		pageQueries: pageQueries.map((q) => parse(q)),
		functionQueries: functionQueries.map((q) => parse(q)),
		middlewareQuery: middlewareQuery ? parse(middlewareQuery) : undefined,
	};

	return `export default function() {console.log("${stringify(options)}");}`;
}

function swapDistFolderWithEsmDistFolder(path: string) {
	return path.replace('next/dist/pages', 'next/dist/esm/pages');
}

function loadSSRPage(this: LoaderContext<Options>, query: EdgeSSRLoaderQuery) {
	const {
		dev,
		page,
		buildId,
		absolutePagePath,
		absoluteAppPath,
		absoluteDocumentPath,
		absolute500Path,
		absoluteErrorPath,
		isServerComponent,
		stringifiedConfig,
		appDirLoader: appDirLoaderBase64,
		pagesType,
		sriEnabled,
		hasFontLoaders,
	} = query;

	const appDirLoader = Buffer.from(
		appDirLoaderBase64 ?? '',
		'base64',
	).toString();
	const isAppDir = pagesType === 'app';

	const stringifiedPagePath = stringifyRequest(this, absolutePagePath);
	const stringifiedAppPath = stringifyRequest(
		this,
		swapDistFolderWithEsmDistFolder(absoluteAppPath),
	);
	const stringifiedErrorPath = stringifyRequest(
		this,
		swapDistFolderWithEsmDistFolder(absoluteErrorPath),
	);
	const stringifiedDocumentPath = stringifyRequest(
		this,
		swapDistFolderWithEsmDistFolder(absoluteDocumentPath),
	);
	const stringified500Path = absolute500Path
		? stringifyRequest(this, absolute500Path)
		: null;

	const pageModPath = `${appDirLoader}${stringifiedPagePath.slice(1, -1)}`;
}
