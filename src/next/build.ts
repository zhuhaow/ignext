import {access} from 'fs/promises';
import {join} from 'path';
import {copy, emptyDir, ensureDir} from 'fs-extra';

export async function build(nextDir: string, outputDir: string) {
  try {
    await access(join(nextDir, '.next'));
  } catch {
    throw new Error(`Failed to find the .next directory in ${nextDir}, run 'next build' first.`);
  }

  await emptyDir(outputDir);

  await copyStaticFiles(nextDir, outputDir);
}

async function copyStaticFiles(nextDir: string, outputDir: string) {
  await ensureDir(join(outputDir, '_next/static'));
  await copy(join(nextDir, '.next/static'), join(outputDir, '_next/static'));
}
