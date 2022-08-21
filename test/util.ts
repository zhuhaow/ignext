import path from 'node:path';
import {execa} from 'execa';

export async function nextBuild(dir: string) {
	return execa(path.join(__dirname, '../node_modules/.bin/next'), ['build', dir]);
}
