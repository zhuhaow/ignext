import path from 'node:path';
import {execa} from 'execa';

export async function nextBuild(dir: string) {
	return execa(path.join(__dirname, '../node_modules/.bin/next'), [
		'build',
		dir,
	]);
}

export function wranglerDev(dir: string, port: number) {
	const wranglerProcess = execa(
		path.resolve(__dirname, '../node_modules/.bin/wrangler'),
		['pages', 'dev', dir, '--port', port.toString()],
		{
			cwd: dir,
		},
	);

	wranglerProcess.stdout?.pipe(process.stdout);
	wranglerProcess.stderr?.pipe(process.stderr);

	return wranglerProcess;
}
