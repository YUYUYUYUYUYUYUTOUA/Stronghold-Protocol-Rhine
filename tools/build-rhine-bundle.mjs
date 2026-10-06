#!/usr/bin/env node
// Build a Windows x64 release staging directory. This does not download, zip, install, or run anything.
//
// node tools/build-rhine-bundle.mjs --out <empty-directory> --runtime-dir <official-node-directory>
//   --runtime-version v24.x.y [--runtime-source-url https://nodejs.org/dist/.../node-...-win-x64.zip]
//   [--runtime-sha256 <verified-official-zip-sha256>] [--source <git-working-tree>]
//
// The output is <out>/Stronghold-Protocol-Rhine. Source files come from Git's tracked file list,
// using their current working-tree contents; the manifest records HEAD and whether tracked files are dirty.
// Prepare/verify assets and dependencies first. Only the explicit local-resource roots below are included.
// --runtime-version is release metadata supplied by the caller, not an executable/version verification.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLE_NAME = 'Stronghold-Protocol-Rhine';
export const MANIFEST_NAME = 'bundle-manifest.json';
const LOCAL_DIRS = ['public/assets', 'public/fonts', 'public/vendor', 'node_modules'];
const LOCAL_FILES = ['data/local-assets.json'];

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function portablePath(relative) {
  if (!relative || relative.includes('\\') || relative.includes(':') || path.posix.isAbsolute(relative)
      || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe bundle path: ${relative}`);
  }
  return relative;
}

// Applied even to tracked files and to files nested under otherwise permitted resource directories.
// A package's ordinary source directory named "cache" remains valid; actual local caches use .cache etc.
export function excludedFromBundle(relative) {
  const parts = relative.toLowerCase().split('/');
  const name = parts.at(-1);
  if (parts.some(part => ['.git', '.cache', '.rhine-updates', '.npm', '.yarn', '__pycache__', 'logs', '.idea', '.vscode', '.claude'].includes(part))) return true;
  if (name === '.env' || name.startsWith('.env.') || ['.npmrc', '.netrc', '.pypirc', '.ds_store', 'thumbs.db', 'desktop.ini'].includes(name)) return true;
  if (/\.(?:log|pyc|pyo|swp)$/i.test(name) || /(?:^|[-_.])verification(?:[-_.].*)?\.json$/i.test(name)) return true;
  return ['scripts/service.env.cmd', 'tools/deploy-rhine-update.ps1'].includes(relative.toLowerCase())
    || relative.toLowerCase().startsWith('test/e2e/out/');
}

// Reject links instead of following them: npm links/junctions and asset links can escape the allowed roots.
function checkChain(root, relative, directory = false) {
  let current = root;
  for (const part of portablePath(relative).split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink/junction is not allowed in bundle inputs: ${relative}`);
  }
  const stat = fs.lstatSync(current);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Bundle input is not a regular ${directory ? 'directory' : 'file'}: ${relative}`);
  return stat;
}

function walk(root, relative, visit) {
  if (excludedFromBundle(relative)) return;
  const source = path.join(root, ...portablePath(relative).split('/'));
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`Symlink/junction is not allowed in bundle inputs: ${relative}`);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(source).sort()) walk(root, `${relative}/${name}`, visit);
  } else if (stat.isFile()) visit(relative, source, stat);
  else throw new Error(`Bundle input is not a regular file: ${relative}`);
}

function resolveOutput(out) {
  const absolute = path.resolve(out);
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('The output directory or its ancestors must not be a symlink/junction');
    if (!stat.isDirectory()) throw new Error('The output path must be a directory');
    current = fs.realpathSync.native(current); // Normalize Windows short (8.3) names before containment checks.
  }
  if (fs.existsSync(current) && fs.readdirSync(current).length) throw new Error('Output directory is not empty; choose a new directory');
  return current;
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Stage a bundle; paths in the manifest are relative and never contain local machine directory names. */
export async function buildBundle({ source = ROOT, out, runtimeDir, runtimeVersion, runtimeSourceUrl, runtimeSha256 } = {}) {
  if (!out || !runtimeDir || !runtimeVersion) throw new Error('--out, --runtime-dir and --runtime-version are required');
  if (!/^v?\d+\.\d+\.\d+$/.test(runtimeVersion) || Number(runtimeVersion.replace(/^v/, '').split('.')[0]) < 22) {
    throw new Error('--runtime-version must be a Node.js version >= 22, such as v24.14.1');
  }
  if (runtimeSourceUrl) {
    const url = new URL(runtimeSourceUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'nodejs.org' || url.username || url.password || url.search || url.hash) {
      throw new Error('--runtime-source-url must be an official https://nodejs.org/ URL without credentials or query parameters');
    }
  }
  if (runtimeSha256 && !/^[0-9a-f]{64}$/i.test(runtimeSha256)) throw new Error('--runtime-sha256 must contain 64 hexadecimal characters');
  const root = fs.realpathSync.native(source);
  const runtime = fs.realpathSync.native(runtimeDir);
  if (!fs.statSync(root).isDirectory() || !fs.statSync(runtime).isDirectory()) throw new Error('Source and runtime inputs must be directories');
  if (path.relative(fs.realpathSync.native(git(root, ['rev-parse', '--show-toplevel']).trim()), root) !== '') {
    throw new Error('--source must be the Git working-tree root');
  }
  const output = resolveOutput(out);
  if (contained(output, root) || contained(output, runtime) || contained(runtime, output)
      || LOCAL_DIRS.some(relative => contained(path.join(root, relative), output))) {
    throw new Error('Output must not overlap source/runtime inputs (a separate .cache staging directory is allowed)');
  }
  for (const file of ['node.exe', 'LICENSE']) checkChain(runtime, file);
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  const status = git(root, ['status', '--porcelain', '--untracked-files=no']);
  const files = new Map();
  const add = (relative, file, stat, kind) => {
    portablePath(relative);
    if (relative === MANIFEST_NAME) throw new Error(`${MANIFEST_NAME} is reserved for the generated release manifest`);
    const key = relative.toLowerCase(); // This bundle targets Windows, including when prepared on another OS.
    const previous = files.get(key);
    if (previous) {
      if (previous.source === file && previous.path === relative) return;
      throw new Error(`Conflicting Windows bundle path: ${relative}`);
    }
    files.set(key, { path: relative, source: file, size: stat.size, kind });
  };
  for (const relative of git(root, ['ls-files', '--cached', '-z']).split('\0').filter(Boolean)) {
    portablePath(relative);
    if (excludedFromBundle(relative)) continue;
    add(relative, path.join(root, relative), checkChain(root, relative), 'tracked');
  }
  for (const relative of LOCAL_DIRS) {
    if (!fs.existsSync(path.join(root, relative))) throw new Error(`Required local resource directory is missing: ${relative}`);
    checkChain(root, relative, true);
    const before = files.size;
    walk(root, relative, (name, file, stat) => add(name, file, stat, 'local-resource'));
    if (files.size === before && ![...files.values()].some(file => file.path.startsWith(`${relative}/`))) {
      throw new Error(`Required local resource directory is empty: ${relative}`);
    }
  }
  for (const relative of LOCAL_FILES) {
    if (fs.existsSync(path.join(root, relative))) add(relative, path.join(root, relative), checkChain(root, relative), 'local-resource');
  }
  for (const name of fs.readdirSync(runtime).sort()) {
    walk(runtime, name, (relative, file, stat) => add(`runtime/node/${relative}`, file, stat, 'runtime'));
  }
  // No output is created until all inputs have passed selection and traversal checks.
  fs.mkdirSync(output, { recursive: true });
  const destination = path.join(output, BUNDLE_NAME);
  fs.mkdirSync(destination); // No recursive mkdir here: an unexpected existing stage must fail closed.
  const manifestFiles = [];
  for (const entry of [...files.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'))) {
    const target = path.join(destination, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(entry.source, target, fs.constants.COPYFILE_EXCL);
    const size = fs.statSync(target).size;
    if (size !== entry.size) throw new Error(`Input changed during copy: ${entry.path}; discard this incomplete stage`);
    manifestFiles.push({ path: entry.path, size, sha256: await sha256(target), source: entry.kind });
  }
  if (git(root, ['rev-parse', 'HEAD']).trim() !== commit || git(root, ['status', '--porcelain', '--untracked-files=no']) !== status) {
    throw new Error('Tracked source state changed during the build; discard this incomplete stage and rebuild');
  }
  const manifest = {
    schemaVersion: 1,
    bundle: BUNDLE_NAME,
    createdAt: new Date().toISOString(),
    sourceCommit: commit,
    sourceDirty: status.trim().length > 0,
    sourceSelection: 'Git tracked paths, current working-tree contents',
    runtime: {
      version: `v${runtimeVersion.replace(/^v/, '')}`,
      versionSource: 'caller-supplied --runtime-version; executable verification is a separate release check',
      platform: 'win32', arch: 'x64', path: 'runtime/node',
      ...(runtimeSourceUrl ? { sourceUrl: runtimeSourceUrl } : {}),
      ...(runtimeSha256 ? { archiveSha256: runtimeSha256.toLowerCase() } : {}),
    },
    hashCoverage: `All payload files; ${MANIFEST_NAME} itself is excluded to avoid a self-referential hash`,
    fileCount: manifestFiles.length,
    totalBytes: manifestFiles.reduce((sum, file) => sum + file.size, 0),
    files: manifestFiles,
  };
  fs.writeFileSync(path.join(destination, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { destination, manifest };
}

function parseArgs(argv) {
  const options = {};
  const names = { '--out': 'out', '--runtime-dir': 'runtimeDir', '--runtime-version': 'runtimeVersion', '--runtime-source-url': 'runtimeSourceUrl', '--runtime-sha256': 'runtimeSha256', '--source': 'source' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') return { help: true };
    const equals = argv[i].indexOf('=');
    const name = equals < 0 ? argv[i] : argv[i].slice(0, equals);
    if (!names[name]) throw new Error(`Unknown argument: ${name}`);
    const value = equals < 0 ? argv[++i] : argv[i].slice(equals + 1);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
    if (options[names[name]] !== undefined) throw new Error(`Duplicate argument: ${name}`);
    options[names[name]] = value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).map(line => line.replace(/^\/\/ ?/, '')).join('\n'));
    else {
      const result = await buildBundle(options);
      console.log(`Staged ${result.manifest.fileCount} files (${result.manifest.totalBytes} bytes) at ${result.destination}`);
      console.log(`Source: ${result.manifest.sourceCommit}${result.manifest.sourceDirty ? ' (tracked working-tree changes present)' : ''}`);
    }
  } catch (error) {
    console.error(`Bundle build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
