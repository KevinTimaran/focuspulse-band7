const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const mode = process.argv[2];
if (!['build', 'preview'].includes(mode)) throw new Error('Use build or preview');
const bundle = require.resolve('@zeppos/zpm/lib/node.js');
const original = fs.readFileSync(bundle, 'utf8');
const needle = 'let g=A[0]||0;';
if (original.split(needle).length !== 2) throw new Error('Unexpected Zeus packager version');
// Band 7 has no icon resize dimensions in the device catalogue.
const guard = needle + 'if(!(g>0))return yield r().move(o,t);';
try {
  fs.writeFileSync(bundle, original.replace(needle, guard));
  const cli = path.join(path.dirname(require.resolve('@zeppos/zeus-cli/package.json')), 'bin', 'main.js');
  const result = spawnSync(process.execPath, [cli, mode, '-t', 'band-7'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
} finally {
  fs.writeFileSync(bundle, original);
}
