# Windows PowerShell 5.1-compatible portable launcher. Keep this file UTF-8 with BOM.
# Double-click the root batch file; optional args: --port 3001 --host 127.0.0.1 --no-open.

function Get-RhineLaunchOptions {
    param([string[]]$Arguments = @())
    $listenPort = if ($env:PORT) { $env:PORT } else { '3000' }
    $listenHost = if ($env:HOST) { $env:HOST } else { '0.0.0.0' }
    $noOpen = $env:SP_NO_BROWSER -match '^(1|true|yes)$'
    $help = $false
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        $arg = $Arguments[$i]
        if ($arg -eq '--no-open') { $noOpen = $true; continue }
        if ($arg -eq '--no-setup') { continue }
        if ($arg -eq '--help' -or $arg -eq '-h') { $help = $true; continue }
        if ($arg -match '^--(port|host)(?:=(.*))?$') {
            $key = $Matches[1]
            if ($arg.Contains('=')) { $value = $Matches[2] }
            else {
                $i++
                if ($i -ge $Arguments.Count) { throw "参数 $arg 缺少值。" }
                $value = $Arguments[$i]
            }
            if ($key -eq 'port') { $listenPort = $value } else { $listenHost = $value }
            continue
        }
        throw "无法识别参数：$arg。支持 --port、--host、--no-open。"
    }
    $portNumber = 0
    if (-not [int]::TryParse($listenPort, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535) {
        throw '端口须为 1 到 65535 的整数。'
    }
    if ([string]::IsNullOrWhiteSpace($listenHost) -or $listenHost -match '\s' -or $listenHost.StartsWith('-')) {
        throw '监听地址无效，例如 127.0.0.1 或 0.0.0.0。'
    }
    [pscustomobject]@{ Port = $portNumber; ListenHost = $listenHost; NoOpen = $noOpen; Help = $help }
}

function Get-RhineNodeMajor {
    param([string]$NodePath)
    try {
        $output = @(& $NodePath --version 2>$null)
        if ($LASTEXITCODE -eq 0 -and $output.Count -eq 1 -and $output[0] -match '^v([0-9]+)\.') { return [int]$Matches[1] }
    } catch { }
    return 0
}

function Find-RhineNode {
    param([string]$Root)
    $candidates = @((Join-Path $Root 'runtime\node\node.exe'))
    $systemNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($systemNode) { $candidates += $systemNode.Source }
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and (Get-RhineNodeMajor $candidate) -ge 22) { return $candidate }
    }
    return $null
}

function Test-RhineCommandLine {
    param([string]$Root, [string]$CommandLine)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $entry = [IO.Path]::GetFullPath((Join-Path $Root 'server\index.js')).Replace('/', '\')
    $line = $CommandLine.Replace('/', '\')
    # launch.mjs starts the server using its absolute entry path. Relative/uninspectable commands are not guessed.
    return [regex]::IsMatch($line, '(?:^|\s)"?' + [regex]::Escape($entry) + '"?(?:\s|$)', 'IgnoreCase')
}

function Get-RhinePortState {
    param([int]$Port, [string]$Root)
    $occupied = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -eq $Port }).Count -gt 0
    if (-not $occupied) { return [pscustomobject]@{ Occupied = $false; SameDirectory = $false } }
    try {
        $owners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique)
        if ($owners.Count -eq 0) { throw 'No listener identity' }
        foreach ($ownerPid in $owners) {
            $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction Stop
            if (-not $processInfo -or -not (Test-RhineCommandLine $Root $processInfo.CommandLine)) {
                return [pscustomobject]@{ Occupied = $true; SameDirectory = $false }
            }
        }
        return [pscustomobject]@{ Occupied = $true; SameDirectory = $true }
    } catch {
        # Being unable to inspect another user's process must never turn into opening or stopping that service.
        return [pscustomobject]@{ Occupied = $true; SameDirectory = $false }
    }
}

function Get-RhineHttpBytes {
    param([string]$Url)
    $request = [Net.HttpWebRequest][Net.WebRequest]::Create($Url)
    $request.Proxy = $null
    $request.AllowAutoRedirect = $false
    $request.Timeout = 3000
    $request.ReadWriteTimeout = 3000
    $response = $null
    $memory = New-Object IO.MemoryStream
    try {
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200) { throw 'HTTP status was not 200' }
        $stream = $response.GetResponseStream()
        try { $stream.CopyTo($memory) } finally { $stream.Dispose() }
        return ,$memory.ToArray()
    } finally {
        if ($response) { $response.Dispose() }
        $memory.Dispose()
    }
}

function Get-RhineBytesHash {
    param([byte[]]$Bytes)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Test-RhineRunningService {
    param([string]$Root, [int]$Port, [string]$ListenHost)
    $address = if ($ListenHost -eq '0.0.0.0') { '127.0.0.1' } elseif ($ListenHost -eq '::') { '[::1]' }
        elseif ($ListenHost.Contains(':') -and -not $ListenHost.StartsWith('[')) { '[' + $ListenHost + ']' } else { $ListenHost }
    $baseUrl = 'http://' + $address + ':' + $Port
    try {
        $package = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $health = [Text.Encoding]::UTF8.GetString((Get-RhineHttpBytes ($baseUrl + '/healthz'))) | ConvertFrom-Json
        if ($health.ok -ne $true -or $health.app -ne $package.version) { return $false }
        $localBonds = Get-Content -LiteralPath (Join-Path $Root 'data\bonds.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $localBonds.rhineShip) { return $false }
        foreach ($name in @('bonds', 'chess', 'items', 'tokens')) {
            $localHash = Get-RhineBytesHash ([IO.File]::ReadAllBytes((Join-Path $Root ('data\' + $name + '.json'))))
            $remoteHash = Get-RhineBytesHash (Get-RhineHttpBytes ($baseUrl + '/data/' + $name + '.json'))
            if ($localHash -ne $remoteHash) { return $false }
        }
        return $true
    } catch { return $false }
}

function Invoke-RhineBundle {
    param([string]$Root, [string[]]$Arguments = @())
    $options = Get-RhineLaunchOptions $Arguments
    if ($options.Help) {
        Write-Host '莱茵科研整合包：双击启动；默认端口 3000。'
        Write-Host '可选参数：--port 3001 --host 127.0.0.1 --no-open'
        Write-Host '也支持 PORT、HOST、SP_NO_BROWSER 环境变量。整合包始终离线启动，不自动下载。'
        return 0
    }
    foreach ($relative in @('scripts\launch.mjs', 'server\index.js', 'node_modules\ws\package.json', 'public\vendor\preact.module.js', 'data\bonds.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
            Write-Host "整合包文件不完整：$relative。请完整解压压缩包后再启动，不要直接在压缩软件中运行。" -ForegroundColor Red
            return 1
        }
    }
    $nodePath = Find-RhineNode $Root
    if (-not $nodePath) {
        Write-Host '没有找到可用的 Node.js 22 或更新版本。请重新完整解压便携包，或从 nodejs.org 安装 Node.js 24 LTS。' -ForegroundColor Red
        return 1
    }
    $portState = Get-RhinePortState $options.Port $Root
    if ($portState.Occupied) {
        if (-not $portState.SameDirectory -or -not (Test-RhineRunningService $Root $options.Port $options.ListenHost)) {
            Write-Host "端口 $($options.Port) 已有其他程序、其他目录的游戏，或不同版本的服务。此窗口不会停止它，也不会打开旧版。" -ForegroundColor Yellow
            Write-Host '请回到原服务窗口结束旧服务，或在本目录运行：'
            $nextPort = if ($options.Port -lt 65535) { $options.Port + 1 } else { 3001 }
            Write-Host ('  .\启动莱茵科研版.bat --port ' + $nextPort)
            Write-Host '如原服务还有对局，请先让本局结束。'
            return 2
        }
        Write-Host '已确认同目录、同版本及同莱茵数据的服务正在运行。' -ForegroundColor Green
    }
    Push-Location -LiteralPath $Root
    try {
        $launchArgs = @((Join-Path $Root 'scripts\launch.mjs'), '--port', [string]$options.Port,
            '--host', $options.ListenHost, '--no-setup')
        if ($options.NoOpen) { $launchArgs += '--no-open' }
        & $nodePath @launchArgs
        return $LASTEXITCODE
    } finally { Pop-Location }
}

# Dot-sourcing exposes pure helpers to the logic tests, without probing ports or starting any service.
if ($MyInvocation.InvocationName -ne '.') {
    $ErrorActionPreference = 'Stop'
    $root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    try { exit (Invoke-RhineBundle $root $args) }
    catch {
        Write-Host ('启动失败：' + $_.Exception.Message) -ForegroundColor Red
        exit 1
    }
}
