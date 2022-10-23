import {existsSync, writeFileSync} from 'node:fs';
import {access} from 'node:fs/promises';
import path, {basename, dirname, join, normalize, relative} from 'node:path';
import {
	copy,
	emptyDir,
	ensureDir,
	ensureDirSync,
	PathLike,
	readFile,
} from 'fs-extra';
import klaw from 'klaw';
import {BUILD_ID_FILE} from 'next/constants';
import {camelCase} from 'change-case';

export async function export_(nextDir: PathLike) {
	nextDir = normalize(resolve(nextDir.toString()));
	const outputDir = normalize(resolve(join(nextDir, '.ignext')));

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
	return readFile(resolve(nextDir, '.next', BUILD_ID_FILE), 'utf8');
}

async function buildHandler(nextDir: PathLike, outputDir: PathLike) {
	function getVariableName(path: string): string {
		return camelCase(basename(path.toString(), '.json'));
	}

	function generateImport(path: PathLike): string {
		if (!existsSync(resolve(nextDir, '.next', path))) {
			return '';
		}

		const variableName = getVariableName(path.toString());

		return `
			import ${variableName} from "${resolve(nextDir, '.next', path)}";
		`;
	}

	const buildId = await readFile(resolve(nextDir, '.next', 'BUILD_ID'), 'utf8');

	const manifestList = [
		'build-manifest.json',
		'prerender-manifest.json',
		'react-loadable-manifest.json',
		'routes-manifest.json',
		'server/middleware-manifest.json',
		'server/pages-manifest.json',
		'server/font-manifest.json',
	];

	const handlerSource = `
		${manifestList.map((manifest) => generateImport(manifest)).join('\n')}\n

		const MANIFESTS = {
			buildId: ${JSON.stringify(buildId)},
			${manifestList.map((manifest) => getVariableName(manifest)).join(',\n')}
		};

		import {createOnRequestHandler} from "${resolve(
			nextDir,
			'.next',
			'server',
			'.ignext',
			'handler.js',
		)}";

		export const onRequest = createOnRequestHandler(MANIFESTS);
	`;

	ensureDirSync(resolve(outputDir, 'functions'));
	writeFileSync(resolve(outputDir, 'functions', '[[path]].js'), handlerSource);
}
