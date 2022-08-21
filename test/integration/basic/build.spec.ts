import {nextBuild} from '../../util';

beforeAll(async () => {
  await nextBuild(__dirname);
});

test('Test building works', () => undefined);
