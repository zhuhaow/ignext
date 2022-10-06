import {access} from 'node:fs/promises';
import path, {basename, dirname, normalize, relative} from 'node:path';
import {copy, emptyDir, ensureDir, PathLike, readFile} from 'fs-extra';
import klaw from 'klaw';
import {BUILD_ID_FILE} from 'next/constants';

export async function export_(nextDir: PathLike, outputDir: PathLike) {
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

	await copyHandler(nextDir, outputDir);
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
	return readFile(resolve(nextDir, '.next', BUILD_ID_FILE), 'utf8');
}

async function copyHandler(nextDir: PathLike, outputDir: PathLike) {
	await copy(
		resolve(nextDir, '.next', 'server', 'ignext', '[[path]].js'),
		resolve(outputDir, 'functions', '[[path]].js'),
	);
}
