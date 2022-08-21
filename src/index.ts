import {program} from './args';

async function main() {
  await program.parseAsync();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
