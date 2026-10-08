const { spawnSync } = require('node:child_process');
const { mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { createRequire, globalPaths } = require('node:module');
const { tmpdir } = require('node:os');
const path = require('node:path');

// Use Vite's existing esbuild dependency, including installations that keep
// transitive dependencies nested instead of hoisting them to node_modules.
const requireFromVite = createRequire(require.resolve('vite/package.json'));
const { buildSync } = requireFromVite('esbuild');
const frontendRoot = path.resolve(__dirname, '../..');
const testFiles = readdirSync(__dirname).filter((name) => name.endsWith('.test.ts')).sort();
if (testFiles.length === 0) throw new Error('No unit test files found.');

const outputDirectory = mkdtempSync(path.join(tmpdir(), 'home-media-unit-'));
try {
  const outputs = testFiles.map((name) => {
    const outfile = path.join(outputDirectory, name.replace(/\.ts$/, '.cjs'));
    buildSync({
      absWorkingDir: frontendRoot,
      entryPoints: [path.join(__dirname, name)],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      // The API service is mocked by tests; importing it must not need Vite.
      define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
      // Preserve Node's explicit NODE_PATH support for an existing isolated
      // dependency installation; normal local installs require no environment.
      nodePaths: globalPaths,
    });
    return outfile;
  });
  const result = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
