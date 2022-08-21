import {join} from 'node:path';
import {nextBuild} from '../../util';
import {build} from '../../../src/command/build';

jest.setTimeout(20_000);

beforeAll(async () => {
	await nextBuild(__dirname);
});

test('Test ignext build works', async () => {
	await build(__dirname, join(__dirname, '.ignext'));
});
