#!/usr/bin/env node

import {program} from './args';

async function main() {
	await program.parseAsync();
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
