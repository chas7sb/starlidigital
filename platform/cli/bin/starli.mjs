#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = join(__dirname, '..', 'dist', 'index.js');

if (existsSync(distEntry)) {
  const mod = await import(pathToFileURL(distEntry).href);
  await mod.runCli(process.argv.slice(2));
} else {
  const srcEntry = join(__dirname, '..', 'src', 'index.ts');
  const mod = await import(pathToFileURL(srcEntry).href);
  await mod.runCli(process.argv.slice(2));
}
