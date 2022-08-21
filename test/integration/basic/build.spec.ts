import {nextBuild} from '../../util';

jest.setTimeout(20000);

beforeAll(async () => {
  await nextBuild(__dirname);
});

test('Test building works', () => undefined);
