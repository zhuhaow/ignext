// eslint-disable-next-line unicorn/prefer-node-protocol
import {stringify} from 'querystring';
import type {LoaderContext} from 'webpack';
import type {EdgeSSRLoaderQuery} from 'next/dist/build/webpack/loaders/next-edge-ssr-loader';
import type {EdgeFunctionLoaderOptions} from 'next/dist/build/webpack/loaders/next-edge-function-loader';
import {getModuleBuildInfo} from 'next/dist/build/webpack/loaders/get-module-build-info';

export interface Options {
	pageQueries: string[];
	functionQueries: string[];
	middlewareQuery?: string;
}

export default function ignextServerLoader(this: LoaderContext<Options>) {
	const options = this.getOptions();

	return `export default function() {console.log("${stringify(options)}");}`;
}
