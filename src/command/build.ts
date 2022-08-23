import {access} from 'node:fs/promises';
import path, {basename, dirname, normalize, relative} from 'node:path';
import {
	copy,
	emptyDir,
	ensureDir,
	pathExists,
	PathLike,
	readFile,
	readJson,
	writeFile,
} from 'fs-extra';
import klaw from 'klaw';

export async function build(nextDir: PathLike, outputDir: PathLike) {
	nextDir = normalize(resolve(nextDir.toString()));
	outputDir = normalize(resolve(outputDir.toString()));

	try {
		await access(resolve(nextDir, '.next'));
	} catch {
		throw new Error(
			`Failed to find the .next directory in ${nextDir}, run 'next build' first.`,
		);
	}

	await emptyDir(outputDir);

	await copyStaticAssets(nextDir, outputDir);

	await copyStaticBuiltPages(nextDir, outputDir);

	await buildHandler(nextDir, outputDir);
}

async function copyStaticAssets(nextDir: PathLike, outputDir: PathLike) {
	await ensureDir(resolve(outputDir, '_next/static'));
	await copy(
		resolve(nextDir, '.next/static'),
		resolve(outputDir, '_next/static'),
	);
}

// We have to scan the server/pages folder to find these generated files.
// pages-manifest.json only contains the mapping of source files.
async function copyStaticBuiltPages(nextDir: PathLike, outputDir: PathLike) {
	await ensureDir(resolve(outputDir, '_next/data', await buildId(nextDir)));

	for await (const file of klaw(resolve(nextDir, '.next/server/pages'))) {
		if (file.stats.isFile()) {
			if (file.path.endsWith('.json') && !file.path.endsWith('.nft.json')) {
				await copy(
					file.path,
					resolve(
						outputDir,
						'_next/data',
						await buildId(nextDir),
						relative(
							resolve(nextDir, '.next/server/pages'),
							dirname(file.path),
						),
						basename(file.path),
					),
				);
			}

			if (file.path.endsWith('.html')) {
				await copy(
					file.path,
					resolve(
						outputDir,
						relative(
							resolve(nextDir, '.next/server/pages'),
							dirname(file.path),
						),
						basename(file.path),
					),
				);
			}
		}
	}
}

function resolve(...paths: PathLike[]): string {
	return path.resolve(...paths.map((p) => p.toString()));
}

async function buildId(nextDir: PathLike) {
	return readFile(resolve(nextDir, '.next/BUILD_ID'), 'utf8');
}

interface NftResult {
	files: string[];
}

async function getEdgeScriptList(nextDir: PathLike): Promise<string[]> {
	const webpackRuntimePath = resolve(
		nextDir,
		'.next/server/edge-runtime-webpack.js',
	);

	if (!(await pathExists(webpackRuntimePath))) {
		console.warn('Cannot find any edge functions.');
		return [];
	}

	const result: string[] = [];
	// Don't why these files are put under page instead of server/page, seems like an error.
	for await (const file of klaw(resolve(nextDir, '.next/pages'))) {
		if (file.path.endsWith('.nft.json')) {
			const nft = (await readJson(file.path)) as NftResult;
			if (
				nft.files.findIndex(
					(f) => resolve(dirname(file.path), f) === webpackRuntimePath,
				) !== -1
			) {
				result.push(
					...nft.files
						.filter(
							(f) =>
								f.endsWith('.js') &&
								resolve(dirname(file.path), f) !== webpackRuntimePath,
						)
						.map((f) => resolve(dirname(file.path), f)),
				);
			}
		}
	}

	result.push(webpackRuntimePath);

	console.log(result);

	return result;
}

async function buildHandler(nextDir: PathLike, outputDir: PathLike) {
	const scriptList = await getEdgeScriptList(nextDir);

	await ensureDir(resolve(outputDir, 'functions'));

	await writeFile(
		resolve(outputDir, 'functions', '[[path]].js'),
		scriptList
			.map((s) => `require("${relative(resolve(outputDir, 'functions'), s)}");`)
			.join('\n'),
	);
}
