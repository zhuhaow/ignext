import {execa} from 'execa';
import path from 'path';

export async function nextBuild(dir: string) {
  return execa(path.join(__dirname, '../node_modules/.bin/next'), ['build', dir]);
}
