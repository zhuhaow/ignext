import {program} from './args';

async function main() {
  await program.parseAsync();
}

main().then(() => {}).catch(err => {});
