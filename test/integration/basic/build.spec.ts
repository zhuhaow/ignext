import {join} from 'node:path';
import {ExecaChildProcess} from 'execa';
import getPort from 'get-port';
import 'isomorphic-fetch';
import waitOn from 'wait-on';
import {export_} from '../../../src/command/export';
import {nextBuild, wranglerDev} from '../../util';
import {verificationString as staticVerificationString} from './pages/staticpages/[page]';
import {verificationString as fullyStaticVerificationString} from './pages/staticpages/fully-static';

jest.setTimeout(20_000_000);

let wranglerProcess: ExecaChildProcess | undefined;
let wranglerPort: number;

beforeAll(async () => {
	await nextBuild(__dirname);
	await export_(__dirname);
	wranglerPort = await getPort();
	wranglerProcess = wranglerDev(join(__dirname, '.ignext'), wranglerPort);
	await waitOn({resources: ['tcp:localhost:' + wranglerPort.toString()]});
});

test('No op test', async () => {
	expect(true);
});

test.skip('test API', async () => {
	const response = await fetch(getHost() + '/api/hello');
	expect(await response.text()).toBe('Hello World');
});

test('test index pages', async () => {
	const response = await fetch(String(getHost()));
	expect(await response.text()).toContain('This is /');
});

test('static generated page', async () => {
	const response1 = await fetch(String(getHost() + '/staticpages/test'));
	expect(await response1.text()).toContain(staticVerificationString('test'));

	const response2 = await fetch(
		String(getHost() + '/staticpages/fully-static'),
	);
	expect(await response2.text()).toContain(fullyStaticVerificationString());
});

afterAll(() => {
	wranglerProcess?.kill('SIGTERM');
});

function getHost() {
	return join('http://localhost:' + wranglerPort.toString());
}
