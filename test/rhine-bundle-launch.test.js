// Portable-launcher logic only: no HTTP listener, browser, or game process is started here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
function run(body) {
  const code = `$ErrorActionPreference='Stop'
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    . (Join-Path $env:RHINE_TEST_ROOT 'scripts\\rhine-bundle-launch.ps1')
    ${body}`;
  const result = spawnSync(ps, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], {
    encoding: 'utf8', cwd: path.parse(root).root, timeout: 15000,
    env: { ...process.env, RHINE_TEST_ROOT: root, PORT: '', HOST: '', SP_NO_BROWSER: '' },
  });
  assert.equal(result.status, 0, result.error?.message || `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}
const windows = { skip: process.platform !== 'win32' };

test('portable launcher parses in Windows PowerShell 5.1 and supports CLI/env overrides', windows, () => {
  const result = run(`
    $tokens=$null; $errors=$null
    [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $env:RHINE_TEST_ROOT 'scripts\\rhine-bundle-launch.ps1'), [ref]$tokens, [ref]$errors)
    $defaults=Get-RhineLaunchOptions
    $env:PORT='3005'; $env:HOST='127.0.0.1'; $env:SP_NO_BROWSER='yes'
    $fromEnv=Get-RhineLaunchOptions
    $fromArgs=Get-RhineLaunchOptions @('--port=3006', '--host', '::1', '--no-open', '--no-setup')
    $rejected=0
    foreach ($a in @(@('--port', '0'), @('--port=65536'), @('--port'), @('--host=-invalid'), @('--download'))) {
      try { $null=Get-RhineLaunchOptions $a } catch { $rejected++ }
    }
    @{ major=$PSVersionTable.PSVersion.Major; errors=$errors.Count; defaults=$defaults; fromEnv=$fromEnv; fromArgs=$fromArgs; rejected=$rejected } | ConvertTo-Json -Compress -Depth 5
  `);
  assert.equal(result.major, 5);
  assert.equal(result.errors, 0);
  assert.deepEqual(result.defaults, { Port: 3000, ListenHost: '0.0.0.0', NoOpen: false, Help: false });
  assert.deepEqual(result.fromEnv, { Port: 3005, ListenHost: '127.0.0.1', NoOpen: true, Help: false });
  assert.deepEqual(result.fromArgs, { Port: 3006, ListenHost: '::1', NoOpen: true, Help: false });
  assert.equal(result.rejected, 5);
});

test('portable launcher identifies exact server directory with Chinese and spaces', windows, () => {
  const result = run(`
    $dir='C:\\游戏目录 with spaces\\莱茵'
    $entry=Join-Path $dir 'server\\index.js'
    @{
      exact=Test-RhineCommandLine $dir ('"C:\\Program Files\\nodejs\\node.exe" "' + $entry + '"')
      foreign=Test-RhineCommandLine $dir 'node C:\\other\\server\\index.js'
      suffix=Test-RhineCommandLine $dir ('node "' + $entry + '.old"')
      relative=Test-RhineCommandLine $dir 'node server\\index.js'
      empty=Test-RhineCommandLine $dir ''
    } | ConvertTo-Json -Compress
  `);
  assert.deepEqual(result, { exact: true, foreign: false, suffix: false, relative: false, empty: false });
});

test('portable launcher prefers bundled Node, then a compatible system Node', windows, () => {
  const result = run(`
    $portable=Join-Path $env:RHINE_TEST_ROOT 'runtime\\node\\node.exe'
    function Test-Path { param($LiteralPath, $PathType) return $true }
    function Get-Command { param($Name, $CommandType, $ErrorAction) [pscustomobject]@{ Source='C:\\system-node\\node.exe' } }
    $script:portableMajor=24; $script:systemMajor=22
    function Get-RhineNodeMajor { param($NodePath) if ($NodePath -eq $portable) { return $script:portableMajor }; return $script:systemMajor }
    $preferred=Find-RhineNode $env:RHINE_TEST_ROOT
    $script:portableMajor=0
    $fallback=Find-RhineNode $env:RHINE_TEST_ROOT
    $script:systemMajor=20
    $unsupported=Find-RhineNode $env:RHINE_TEST_ROOT
    @{ preferred=$preferred; portable=$portable; fallback=$fallback; unsupported=$unsupported } | ConvertTo-Json -Compress
  `);
  assert.equal(result.preferred, result.portable);
  assert.equal(result.fallback, 'C:\\system-node\\node.exe');
  assert.equal(result.unsupported, null);
});

test('existing-service identity requires matching release and all four Rhine data files', windows, () => {
  const result = run(`
    $script:healthVersion=(Get-Content (Join-Path $env:RHINE_TEST_ROOT 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $script:corrupt=''; $script:requests=@()
    function Get-RhineHttpBytes {
      param([string]$Url)
      $script:requests += $Url
      if ($Url.EndsWith('/healthz')) {
        return ,([Text.Encoding]::UTF8.GetBytes((@{ok=$true; app=$script:healthVersion} | ConvertTo-Json -Compress)))
      }
      $name=([Uri]$Url).Segments[-1]
      if ($name -eq $script:corrupt) { return ,([Text.Encoding]::UTF8.GetBytes('changed data')) }
      return ,([IO.File]::ReadAllBytes((Join-Path $env:RHINE_TEST_ROOT ('data\\' + $name))))
    }
    $matching=Test-RhineRunningService $env:RHINE_TEST_ROOT 3006 '0.0.0.0'
    $firstRequests=@($script:requests)
    $script:healthVersion='old-release'
    $wrongVersion=Test-RhineRunningService $env:RHINE_TEST_ROOT 3006 '127.0.0.1'
    $script:healthVersion=(Get-Content (Join-Path $env:RHINE_TEST_ROOT 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
    $mismatches=@()
    foreach ($name in @('bonds', 'chess', 'items', 'tokens')) {
      $script:corrupt=$name+'.json'
      $mismatches += (Test-RhineRunningService $env:RHINE_TEST_ROOT 3006 '::')
    }
    @{ matching=$matching; firstRequests=$firstRequests; wrongVersion=$wrongVersion; mismatches=$mismatches; errors=@($Error | ForEach-Object { $_.ToString() }) } | ConvertTo-Json -Compress
  `);
  assert.equal(result.matching, true, JSON.stringify(result));
  assert.deepEqual(result.firstRequests, ['healthz', 'data/bonds.json', 'data/chess.json', 'data/items.json', 'data/tokens.json'].map(p => `http://127.0.0.1:3006/${p}`));
  assert.equal(result.wrongVersion, false);
  assert.deepEqual(result.mismatches, [false, false, false, false]);
});

test('launcher forwards offline options from arbitrary cwd, refuses other/old services without launching', windows, () => {
  const result = run(`
    function Write-Host { param($Object, $ForegroundColor) }
    function Test-Path { param($LiteralPath, $PathType) return $true }
    function Find-RhineNode { param($Root) return 'Invoke-FakeNode' }
    $script:state=[pscustomobject]@{Occupied=$false;SameDirectory=$false}
    function Get-RhinePortState { param($Port,$Root) return $script:state }
    $script:verified=$false
    function Test-RhineRunningService { param($Root,$Port,$ListenHost) return $script:verified }
    $script:calls=@()
    function Invoke-FakeNode {
      $script:calls += [pscustomobject]@{ arguments=@($args); cwd=(Get-Location).Path }
      $global:LASTEXITCODE=0
    }
    $originalCwd=(Get-Location).Path
    $free=Invoke-RhineBundle $env:RHINE_TEST_ROOT @('--port', '3006', '--host', '127.0.0.1', '--no-open')
    $script:state=[pscustomobject]@{Occupied=$true;SameDirectory=$false}
    $foreign=Invoke-RhineBundle $env:RHINE_TEST_ROOT @('--port', '65535')
    $script:state=[pscustomobject]@{Occupied=$true;SameDirectory=$true}
    $oldData=Invoke-RhineBundle $env:RHINE_TEST_ROOT @()
    $script:verified=$true
    $existing=Invoke-RhineBundle $env:RHINE_TEST_ROOT @()
    @{ free=$free;foreign=$foreign;oldData=$oldData;existing=$existing;calls=$script:calls;cwdRestored=((Get-Location).Path -eq $originalCwd) } | ConvertTo-Json -Compress -Depth 5
  `);
  assert.equal(result.free, 0);
  assert.equal(result.foreign, 2);
  assert.equal(result.oldData, 2);
  assert.equal(result.existing, 0);
  assert.equal(result.calls.length, 2);
  assert.equal(result.cwdRestored, true);
  assert.equal(path.resolve(result.calls[0].cwd), path.resolve(root));
  assert.deepEqual(result.calls[0].arguments, [path.join(root, 'scripts', 'launch.mjs'), '--port', '3006', '--host', '127.0.0.1', '--no-setup', '--no-open']);
  assert.deepEqual(result.calls[1].arguments, [path.join(root, 'scripts', 'launch.mjs'), '--port', '3000', '--host', '0.0.0.0', '--no-setup']);
});

test('PowerShell file entry accepts help without starting a service', windows, () => {
  const result = spawnSync(ps, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'rhine-bundle-launch.ps1'), '--help'], {
    cwd: path.parse(root).root, timeout: 15000, env: { ...process.env, PORT: '', HOST: '', SP_NO_BROWSER: '' },
  });
  assert.equal(result.status, 0, result.stderr?.toString());
});

test('root batch works from another cwd in a Chinese/space path with Windows-only PATH', windows, () => {
  const fixture = mkdtempSync(path.join(tmpdir(), '莱茵 离线启动 '));
  try {
    mkdirSync(path.join(fixture, 'scripts'));
    const batch = path.join(fixture, '启动莱茵科研版.bat');
    copyFileSync(path.join(root, '启动莱茵科研版.bat'), batch);
    copyFileSync(path.join(root, 'scripts', 'rhine-bundle-launch.ps1'), path.join(fixture, 'scripts', 'rhine-bundle-launch.ps1'));
    const win = process.env.SystemRoot || 'C:\\Windows';
    const result = spawnSync(path.join(win, 'System32', 'cmd.exe'), ['/d', '/s', '/c', `""${batch}" --help"`], {
      cwd: path.join(win, 'System32'), timeout: 15000, windowsVerbatimArguments: true,
      env: { ...process.env, PATH: `${win}\\System32;${win}`, PORT: '', HOST: '', SP_NO_BROWSER: '', RHINE_NO_PAUSE: '1' },
    });
    assert.equal(result.status, 0, result.error?.message || `${result.stdout}\n${result.stderr}`);
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith('莱茵 离线启动 '));
    rmSync(fixture, { recursive: true, force: true });
  }
});
