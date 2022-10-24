import {Command} from 'commander';
import {version} from '../../package.json';
import {export_} from './export';

const program = new Command();

program
	.name('ignext')
	.version(version)
	.description('Ignite your Next.js app for Cloudflare');

program
	.command('export')
	.description('turn the result of next build into a Cloudflare Pages site')
	.argument('[next_path]', 'the path to the Next.js website', '.')
	.action(async (nextPath) => {
		await export_(nextPath);
	});

export {program};
