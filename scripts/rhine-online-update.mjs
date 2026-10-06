#!/usr/bin/env node
// Public GitHub releases only. Updating never stops services or changes user configuration.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as bundleCore from './rhine-bundle-update.mjs';

export const REPOSITORY = 'YUYUYUYUYUYUYUTOUA/Stronghold-Protocol-Rhine';
export const RELEASE_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const BUNDLE = 'Stronghold-Protocol-Rhine';
const MAX_ARCHIVE = 2 * 1024 ** 3;
const MAX_METADATA = 2 * 1024 ** 2;
const HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);
const execAsync = promisify(execFile);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function inside(root, file) {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
function checkChain(input, create = false) {
  if (typeof input !== 'string' || !input) throw new Error('需要有效的本地安装目录。');
  const absolute = path.resolve(input);
  if (process.platform === 'win32' && absolute.startsWith('\\\\')) throw new Error('请使用本地目录，不支持 UNC 网络共享。');
  let current = path.parse(absolute).root;
  for (const part of path.relative(current, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      if (!create) throw new Error(`目录不存在：${current}`);
      fs.mkdirSync(current);
    }
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(fs.realpathSync.native(current), path.resolve(current))) {
      throw new Error('安装目录、更新缓存及父目录不能是符号链接、junction 或文件。');
    }
  }
  return fs.realpathSync.native(absolute);
}
function readManifest(root, source = false) {
  const file = path.join(root, 'bundle-manifest.json');
  if (!fs.existsSync(file)) throw new Error('旧目录缺少 bundle-manifest.json；仅支持带清单的莱茵整合包。');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 ** 2 || !samePath(fs.realpathSync.native(file), file)) throw new Error('包清单必须是普通本地文件。');
  const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (value.schemaVersion !== 1 || value.bundle !== BUNDLE || !/^[a-f0-9]{40}$/i.test(value.sourceCommit)
      || !Array.isArray(value.files) || !value.files.length || value.files.length > 100000 || value.fileCount !== value.files.length
      || (source && value.sourceDirty !== false)) throw new Error('整合包清单格式或源码提交无效。');
  return value;
}
function checkedUrl(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !HOSTS.has(url.hostname)) {
    throw new Error('下载地址必须使用 GitHub 官方 HTTPS 服务。');
  }
  return url.href;
}
function releaseAsset(metadata, tag, name, maxSize) {
  const assets = metadata.assets.filter(asset => asset?.name === name);
  if (assets.length !== 1) throw new Error(`正式发布必须包含唯一资源：${name}`);
  const asset = assets[0];
  const expected = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
  if (asset.browser_download_url !== expected || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxSize
      || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') || (asset.state && asset.state !== 'uploaded')) {
    throw new Error(`正式资源地址、大小或 SHA256 digest 无效：${name}`);
  }
  return { name, url: checkedUrl(asset.browser_download_url), size: asset.size, sha256: asset.digest.slice(7).toLowerCase() };
}
export function selectRelease(metadata) {
  if (!metadata || metadata.draft !== false || metadata.prerelease !== false || !/^v\d+\.\d+\.\d+-rhine\.\d+$/.test(metadata.tag_name || '') || metadata.tag_name.length > 96
      || !/^[a-f0-9]{40}$/i.test(metadata.target_commitish || '') || !Array.isArray(metadata.assets)) {
    throw new Error('仅接受具有固定源码提交的 GitHub 正式发布；草稿、测试版和分支指向不支持自动更新。');
  }
  const tag = metadata.tag_name;
  return { tag, commit: metadata.target_commitish.toLowerCase(),
    zip: releaseAsset(metadata, tag, `${BUNDLE}-${tag}-Windows-x64.zip`, MAX_ARCHIVE),
    checksum: releaseAsset(metadata, tag, 'SHA256SUMS.txt', 1024 * 1024) };
}
export function parseChecksum(text, name) {
  const matching = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const match = /^([a-f0-9]{64})[ \t]+\*?([^\r\n]+)$/i.exec(raw);
    if (!match) throw new Error('SHA256SUMS.txt 格式无效。');
    if (match[2] === name) matching.push(match[1].toLowerCase());
  }
  if (matching.length !== 1) throw new Error('SHA256SUMS.txt 中没有唯一的目标整合包校验值。');
  return matching[0];
}
async function publicFetch(url, fetchImpl) {
  let current = checkedUrl(url);
  for (let attempt = 0; attempt < 9; attempt++) {
    const response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(30 * 60 * 1000),
      headers: { 'User-Agent': 'Stronghold-Protocol-Rhine-Updater', Accept: current.startsWith('https://api.github.com/') ? 'application/vnd.github+json' : 'application/octet-stream' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('GitHub 重定向缺少地址。');
      current = checkedUrl(new URL(location, current).href);
      await response.body?.cancel?.();
      continue;
    }
    if (!response.ok) { await response.body?.cancel?.(); throw new Error(`GitHub 请求失败（HTTP ${response.status}）。请稍后重试。`); }
    return response;
  }
  throw new Error('GitHub 下载重定向过多。');
}
async function limitedBytes(response, max) {
  if (!response.body) throw new Error('GitHub 返回空响应。');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > max) throw new Error('GitHub 响应超出允许大小。');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
async function hash(file) {
  const value = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) value.update(chunk);
  return value.digest('hex');
}
function cacheFile(directory, name) {
  const file = path.join(directory, name);
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !samePath(fs.realpathSync.native(file), file)) throw new Error('更新缓存不能包含符号链接或目录资源。');
  }
  return file;
}
async function download(asset, cache, fetchImpl, onProgress) {
  const destination = cacheFile(cache, asset.name);
  if (fs.existsSync(destination) && fs.statSync(destination).size === asset.size && await hash(destination) === asset.sha256) {
    onProgress({ type: 'cached', name: asset.name, received: asset.size, total: asset.size });
    return destination;
  }
  const partial = path.join(cache, `${asset.name}.${randomUUID()}.part`);
  let handle;
  try {
    const response = await publicFetch(asset.url, fetchImpl);
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== asset.size)) throw new Error(`下载大小与 GitHub 发布不符：${asset.name}`);
    if (!response.body) throw new Error('GitHub 返回空下载。');
    handle = await fs.promises.open(partial, 'wx');
    const digest = createHash('sha256'); let received = 0, last = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk); received += bytes.length;
      if (received > asset.size) throw new Error(`下载超出发布大小：${asset.name}`);
      digest.update(bytes); await handle.writeFile(bytes);
      if (Date.now() - last >= 1000) { onProgress({ type: 'download', name: asset.name, received, total: asset.size }); last = Date.now(); }
    }
    if (received !== asset.size || digest.digest('hex') !== asset.sha256) throw new Error(`下载 SHA256 或大小校验失败：${asset.name}；旧安装没有修改。`);
    await handle.sync(); await handle.close(); handle = null;
    cacheFile(cache, asset.name);
    fs.renameSync(partial, destination);
    onProgress({ type: 'downloaded', name: asset.name, received, total: asset.size });
    return destination;
  } finally {
    if (handle) await handle.close();
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
  }
}

// ZipArchive is available in the Windows PowerShell 5.1/.NET runtime already on Windows.
// Validate the complete archive before writing the first member, including implicit directory collisions.
export async function extractArchive({ archive, destination }) {
  if (process.platform !== 'win32') throw new Error('自动解压需要 Windows PowerShell 5.1。');
  destination = checkChain(destination);
  if (fs.readdirSync(destination).length) throw new Error('解压目录必须独立且为空。');
  archive = path.resolve(archive);
  const stat = fs.lstatSync(archive);
  if (!stat.isFile() || stat.isSymbolicLink() || !samePath(fs.realpathSync.native(archive), archive)) throw new Error('ZIP 必须是普通本地文件。');
  const script = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($env:RHINE_UPDATER_ARCHIVE)
try {
  $destination = [IO.Path]::GetFullPath($env:RHINE_UPDATER_DESTINATION)
  if (@([IO.Directory]::EnumerateFileSystemEntries($destination)).Count -ne 0) { throw 'Extraction directory is not empty.' }
  $nodes = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
  $explicit = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $total = [long]0
  if ($archive.Entries.Count -eq 0 -or $archive.Entries.Count -gt 100000) { throw 'Invalid ZIP entry count.' }
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName
    if (-not $name -or $name.Contains('\\') -or $name.StartsWith('/') -or $name -match '[<>:"|?*\\x00-\\x1f\\x7f]') { throw ('Unsafe ZIP path: ' + $name) }
    $isDirectory = $name.EndsWith('/')
    $relative = if ($isDirectory) { $name.Substring(0, $name.Length - 1) } else { $name }
    $parts = $relative.Split('/')
    foreach ($part in $parts) {
      if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)') { throw ('Unsafe ZIP component: ' + $name) }
    }
    if ($parts[0] -cne '${BUNDLE}') { throw 'ZIP must have exactly one Stronghold-Protocol-Rhine root.' }
    $mode = ($entry.ExternalAttributes -shr 16) -band 61440
    if ($mode -eq 40960 -or ($entry.ExternalAttributes -band 1024) -ne 0 -or ($mode -ne 0 -and $mode -ne 16384 -and $mode -ne 32768)) { throw ('ZIP links or special files are not permitted: ' + $name) }
    if ($entry.Length -lt 0 -or $entry.Length -gt 2147483648 -or ($isDirectory -and $entry.Length -ne 0)) { throw 'Invalid ZIP uncompressed size.' }
    $total += $entry.Length
    if ($total -gt 17179869184) { throw 'ZIP expanded size exceeds limit.' }
    if (-not $explicit.Add($relative)) { throw ('Duplicate/case-conflicting ZIP entry: ' + $name) }
    $node = ''
    for ($i = 0; $i -lt $parts.Length; $i++) {
      $node = if ($node) { $node + '/' + $parts[$i] } else { $parts[$i] }
      $type = if ($i -lt $parts.Length - 1 -or $isDirectory) { 'dir' } else { 'file' }
      $description = $type + '|' + $node
      if ($nodes.ContainsKey($node)) {
        if ($nodes[$node] -cne $description) { throw ('ZIP file/directory or case collision: ' + $name) }
      } else { $nodes.Add($node, $description) }
    }
    $full = [IO.Path]::GetFullPath([IO.Path]::Combine($destination, $relative.Replace('/', [IO.Path]::DirectorySeparatorChar)))
    if (-not $full.StartsWith($destination.TrimEnd('\\') + '\\', [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP path escapes extraction directory.' }
  }
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName
    $full = [IO.Path]::Combine($destination, $name.Replace('/', [IO.Path]::DirectorySeparatorChar))
    if ($name.EndsWith('/')) { [IO.Directory]::CreateDirectory($full) | Out-Null; continue }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($full)) | Out-Null
    $inputStream = $entry.Open()
    $outputStream = $null
    try {
      $outputStream = New-Object IO.FileStream($full, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $inputStream.CopyTo($outputStream)
      if ($outputStream.Length -ne $entry.Length) { throw 'ZIP extracted size mismatch.' }
    } finally { if ($outputStream) { $outputStream.Dispose() }; $inputStream.Dispose() }
  }
} finally { $archive.Dispose() }`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    await execAsync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 20 * 60 * 1000, maxBuffer: 4 * 1024 ** 2,
      env: { ...process.env, RHINE_UPDATER_ARCHIVE: archive, RHINE_UPDATER_DESTINATION: destination }
    });
  } catch (error) { throw new Error(`ZIP 安全解压失败；旧安装没有修改。${error.stderr || error.message}`); }
}

export async function prepareOnlineUpdate({ target, cacheRoot = path.join(os.tmpdir(), 'Stronghold-Protocol-Rhine-Updates'), fetchImpl = globalThis.fetch,
  extractArchive: extractor = extractArchive, assertStopped = bundleCore.assertBundleStopped, onProgress = () => {}, core = bundleCore, checkOnly = false } = {}) {
  target = checkChain(target);
  const current = readManifest(target);
  await assertStopped(target);
  onProgress({ type: 'checking' });
  const bytes = await limitedBytes(await publicFetch(RELEASE_URL, fetchImpl), MAX_METADATA);
  const release = selectRelease(JSON.parse(bytes.toString('utf8')));
  if (checkOnly) return { status: 'checked', tag: release.tag, commit: release.commit, target,
    currentCommit: current.sourceCommit.toLowerCase(), updateAvailable: current.sourceCommit.toLowerCase() !== release.commit };
  if (current.sourceCommit.toLowerCase() === release.commit) return { status: 'already-current', tag: release.tag, commit: release.commit, target };
  const candidateCache = path.resolve(cacheRoot);
  if (inside(target, candidateCache) || inside(candidateCache, target)) throw new Error('更新缓存必须位于旧安装目录之外，且两者不能互相包含。');
  cacheRoot = checkChain(candidateCache, true);
  const cache = checkChain(path.join(cacheRoot, `${release.tag}-${release.commit.slice(0, 12)}`), true);
  onProgress({ type: 'release', tag: release.tag });
  const checksumFile = await download(release.checksum, cache, fetchImpl, onProgress);
  const checksum = parseChecksum(fs.readFileSync(checksumFile, 'utf8'), release.zip.name);
  if (checksum !== release.zip.sha256) throw new Error('GitHub ZIP digest 与 SHA256SUMS.txt 不一致；旧安装没有修改。');
  const archive = await download(release.zip, cache, fetchImpl, onProgress);
  const destination = path.join(cache, `unpacked-${randomUUID()}`);
  checkChain(destination, true);
  onProgress({ type: 'extracting', tag: release.tag });
  await extractor({ archive, destination });
  const names = fs.readdirSync(destination);
  if (names.length !== 1 || names[0] !== BUNDLE) throw new Error('解压结果必须是唯一的莱茵整合包目录。');
  const source = checkChain(path.join(destination, BUNDLE));
  const manifest = readManifest(source, true);
  if (manifest.sourceCommit.toLowerCase() !== release.commit) throw new Error('整合包源码提交与 GitHub 正式发布不一致；旧安装没有修改。');
  onProgress({ type: 'verifying', tag: release.tag });
  const plan = await core.planUpdate({ source, target });
  if (plan.conflicts.length) throw new Error(`更新存在本地文件冲突，未覆盖任何文件：\n${plan.conflicts.map(item => `${item.path}: ${item.reason}`).join('\n')}`);
  return { status: 'prepared', tag: release.tag, commit: release.commit, target, source, archive, sha256: checksum, plan };
}
export async function runOnlineUpdate(options = {}) {
  const prepared = await prepareOnlineUpdate(options);
  if (prepared.status === 'already-current' || prepared.status === 'checked') return prepared;
  if (options.downloadOnly || options.apply === false) return { ...prepared, status: 'downloaded' };
  const core = options.core || bundleCore;
  const assertStopped = options.assertStopped || core.assertBundleStopped;
  options.onProgress?.({ type: 'applying', tag: prepared.tag, changedFiles: prepared.plan.changes.length });
  const result = await core.applyUpdate({ source: prepared.source, target: prepared.target, assertStopped });
  return { ...prepared, status: result.status, result, backup: result.backup, changedFiles: result.changedFiles };
}

export async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') { console.log('node rhine-online-update.mjs --target <旧安装目录> [--cache <目录>] [--check | --download-only]\n默认下载 GitHub 最新正式整合包、验证并保留配置更新；--check 只检查版本信息，不下载或更新。请先结束对局并手动关闭旧服务。'); return; }
    if (arg === '--check') options.checkOnly = true;
    else if (arg === '--download-only') options.downloadOnly = true;
    else if ((arg === '--target' || arg === '--cache') && args[i + 1] && !args[i + 1].startsWith('--')) options[arg === '--target' ? 'target' : 'cacheRoot'] = args[++i];
    else throw new Error(`未知或缺少参数：${arg}`);
  }
  if (options.checkOnly && options.downloadOnly) throw new Error('请选择检查或只下载中的一个模式。');
  const stages = { checking: '正在查询 GitHub 最新正式版本……', release: '发现正式版本', cached: '复用已重新校验的下载缓存', downloaded: '下载及 SHA256 校验通过', extracting: '正在检查 ZIP 路径并安全解压……', verifying: '正在校验完整载荷和本地冲突……', applying: '正在备份并保留配置更新……' };
  options.onProgress = event => {
    if (event.type === 'download') console.log(`下载 ${event.name}：${(event.received / 1024 ** 2).toFixed(1)} / ${(event.total / 1024 ** 2).toFixed(1)} MB`);
    else console.log(`${stages[event.type] || event.type}${event.tag ? ` ${event.tag}` : ''}${event.name ? `：${event.name}` : ''}`);
  };
  const result = await runOnlineUpdate(options);
  if (result.status === 'already-current') console.log(`已是最新正式版本：${result.tag}`);
  else if (result.status === 'checked') console.log(`最新正式版本：${result.tag}\n${result.updateAvailable ? '有更新可用。' : '已是最新正式版本。'}仅检查版本信息，没有下载或修改旧安装。`);
  else if (result.status === 'downloaded') console.log(`已下载并校验 ${result.tag}，未修改旧安装。\n新包：${result.source}`);
  else console.log(`更新完成：${result.tag}\n备份：${result.backup}\n请从原目录重新启动游戏；工具不会自动启动或停止服务。`);
}
if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => { console.error(`在线更新失败：${error.message}`); process.exitCode = 1; });
}
