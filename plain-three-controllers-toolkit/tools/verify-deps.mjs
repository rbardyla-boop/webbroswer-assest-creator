import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const runtime = Object.keys(pkg.dependencies || {});
const dev = Object.keys(pkg.devDependencies || {});
const badRuntime = runtime.filter((x) => x !== 'three');
const badDev = dev.filter((x) => x !== 'vite');
if (badRuntime.length || badDev.length) {
  console.error('Dependency gate failed. Runtime must be only three; dev must be only vite.');
  console.error({ runtime, dev });
  process.exit(1);
}
console.log('PASS dependency gate: runtime=[three], dev=[vite]');
