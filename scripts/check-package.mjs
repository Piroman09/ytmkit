import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const problems = [];

if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
  problems.push('name is required');
}
if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
  problems.push('version is required');
}
if (!Array.isArray(pkg.files) || !pkg.files.includes('dist')) {
  problems.push('files must include dist');
}

const bin = pkg.bin?.ytmkit;
if (typeof bin !== 'string' || bin.length === 0) {
  problems.push('bin.ytmkit must be a non-empty string');
} else if (bin.startsWith('./') || bin.startsWith('../') || isAbsolute(bin)) {
  problems.push('bin.ytmkit must be relative and must not start with ./ or ../');
} else {
  const binPath = resolve(root, bin);
  const fromRoot = relative(root, binPath);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    problems.push('bin.ytmkit must resolve inside the package');
  } else if (!existsSync(binPath) || !statSync(binPath).isFile()) {
    problems.push(`bin.ytmkit target does not exist: ${bin}`);
  } else {
    const firstLine = readFileSync(binPath, 'utf8').split('\n', 1)[0];
    if (firstLine !== '#!/usr/bin/env node') {
      problems.push('bin.ytmkit target must start with #!/usr/bin/env node');
    }
  }
}

if (problems.length > 0) {
  console.error('Package check failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Package check passed: ${pkg.name}@${pkg.version}, bin ${bin}`);
