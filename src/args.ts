import {Command} from 'commander';
import {join} from 'path';
import {version} from '../package.json';
import {build} from './next/build';

const program = new Command();

program.name('ignext')
  .version(version)
  .description('Ignite your Next.js app for Cloudflare');

program.command('build')
  .description('turn the result of next build into a Cloudflare Pages site')
  .argument('[next_path]', 'the path to the Next.js website', '.')
  .action(async nextPath => {
    await build(nextPath, join(nextPath, '.ignext'));
  });

export {program};

