# Windows PowerShell 5.1, UTF-8 with BOM. Bootstrap runs outside the installation.
$ErrorActionPreference = 'Stop'
$rhineBootstrap = $null
$rhineExit = 1
try {
    $rhineArguments = @($args)
    $rhineOffline = ($rhineArguments -contains '--offline') -or ($rhineArguments -contains '--source') -or ($rhineArguments -contains '--rollback')
    $rhinePowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if ($rhineOffline) {
        $rhineOfflineArguments = @($rhineArguments | Where-Object { $_ -ne '--offline' })
        & $rhinePowerShell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'rhine-bundle-update.ps1') @rhineOfflineArguments | Out-Host
        $rhineExit = $LASTEXITCODE
    } else {
        $rhineTarget = $null
        $rhineCache = $null
        $rhineCheck = $false
        $rhineDownloadOnly = $false
        for ($i = 0; $i -lt $rhineArguments.Count; $i++) {
            $rhineArgument = $rhineArguments[$i]
            if ($rhineArgument -eq '--check') { $rhineCheck = $true; continue }
            if ($rhineArgument -eq '--download-only') { $rhineDownloadOnly = $true; continue }
            if ($rhineArgument -eq '--help') {
                Write-Host '双击联网检查并更新正式最新版。先结束对局并关闭旧服务。'
                Write-Host '可选：--target 安装目录、--cache 缓存目录、--check（仅查更新）、--download-only（只下载和校验）。'
                Write-Host '离线：--offline --source 已解压新包 --target 安装目录；回退沿用 --rollback 备份目录。'
                $rhineExit = 0
                break
            }
            if ($rhineArgument -notin @('--target', '--cache') -or $i + 1 -ge $rhineArguments.Count) { throw "无法识别或缺少参数：$rhineArgument" }
            $i++
            if ($rhineArgument -eq '--target') { $rhineTarget = $rhineArguments[$i] } else { $rhineCache = $rhineArguments[$i] }
        }
        if ($rhineArguments -notcontains '--help') {
            if (-not $rhineCache) {
                if (-not $env:LOCALAPPDATA) { throw '无法定位本机更新缓存目录，请用 --cache 指定安装目录之外的位置。' }
                $rhineCache = Join-Path $env:LOCALAPPDATA 'Stronghold-Protocol-Rhine-Updater'
            }
            $rhineCache = [IO.Path]::GetFullPath($rhineCache)
            $rhineSettings = Join-Path $rhineCache 'settings.json'
            $rhineToolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
            if (-not $rhineTarget -and (Test-Path -LiteralPath (Join-Path $rhineToolRoot 'bundle-manifest.json') -PathType Leaf)) { $rhineTarget = $rhineToolRoot }
            if (-not $rhineTarget -and (Test-Path -LiteralPath $rhineSettings -PathType Leaf)) {
                try {
                    $rhineSaved = Get-Content -LiteralPath $rhineSettings -Raw -Encoding UTF8 | ConvertFrom-Json
                    if ($rhineSaved.target -and (Test-Path -LiteralPath (Join-Path $rhineSaved.target 'bundle-manifest.json') -PathType Leaf)) { $rhineTarget = [string]$rhineSaved.target }
                } catch { }
            }
            Write-Host '莱茵联网更新：自动获取 GitHub 正式最新版，保留配置，先备份再安装。' -ForegroundColor Cyan
            Write-Host '请先结束对局并关闭旧服务；工具不会自动停止服务。'
            if (-not $rhineTarget) { $rhineTarget = (Read-Host '首次使用请输入原来的莱茵安装目录（内有 bundle-manifest.json）').Trim().Trim('"') }
            $rhineTarget = [IO.Path]::GetFullPath($rhineTarget)
            $rhineTargetPrefix = $rhineTarget.TrimEnd('\') + '\'
            if ($rhineCache.Equals($rhineTarget, [StringComparison]::OrdinalIgnoreCase) -or $rhineCache.StartsWith($rhineTargetPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw '缓存目录必须位于安装目录之外。' }
            if (-not (Test-Path -LiteralPath (Join-Path $rhineTarget 'bundle-manifest.json') -PathType Leaf)) { throw '安装目录没有 bundle-manifest.json；仅支持带清单的莱茵整合包。' }
            $rhineManifest = Get-Content -LiteralPath (Join-Path $rhineTarget 'bundle-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($rhineManifest.schemaVersion -ne 1 -or $rhineManifest.bundle -ne 'Stronghold-Protocol-Rhine') { throw '安装目录清单不兼容，请核对选中的目录。' }
            $rhineNode = Join-Path $rhineTarget 'runtime\node\node.exe'
            if (-not (Test-Path -LiteralPath $rhineNode -PathType Leaf)) { throw '安装目录缺少内置 Node.js，请先完整安装 Windows x64 莱茵包。' }
            $rhineBootstrapBase = Join-Path $rhineCache 'bootstrap'
            $rhineBootstrap = Join-Path $rhineBootstrapBase ([Guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $rhineBootstrap -Force | Out-Null
            Copy-Item -LiteralPath $rhineNode -Destination (Join-Path $rhineBootstrap 'node.exe')
            foreach ($rhineFile in @('rhine-bundle-update.mjs', 'rhine-online-update.mjs', 'rhine-online-update-runner.ps1')) {
                Copy-Item -LiteralPath (Join-Path $PSScriptRoot $rhineFile) -Destination (Join-Path $rhineBootstrap $rhineFile)
            }
            $rhineRunnerArguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                (Join-Path $rhineBootstrap 'rhine-online-update-runner.ps1'), '-RhineTarget', $rhineTarget, '-RhineCache', $rhineCache)
            if ($rhineCheck) { $rhineRunnerArguments += '-CheckOnly' }
            if ($rhineDownloadOnly) { $rhineRunnerArguments += '-DownloadOnly' }
            & $rhinePowerShell @rhineRunnerArguments | Out-Host
            $rhineExit = $LASTEXITCODE
            if ($rhineExit -eq 0) {
                $rhineSavedSettings = @{ schemaVersion = 1; target = $rhineTarget }
                [IO.File]::WriteAllText($rhineSettings, ($rhineSavedSettings | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
            }
        }
    }
} catch {
    Write-Host ('更新失败：' + $_.Exception.Message) -ForegroundColor Red
    $rhineExit = 1
} finally {
    if ($rhineBootstrap -and (Test-Path -LiteralPath $rhineBootstrap)) {
        # Only remove this run's uniquely named external bootstrap after its child exited.
        $rhineAbsoluteBootstrap = [IO.Path]::GetFullPath($rhineBootstrap)
        $rhineAbsoluteBase = [IO.Path]::GetFullPath($rhineBootstrapBase)
        if ([IO.Path]::GetDirectoryName($rhineAbsoluteBootstrap).Equals($rhineAbsoluteBase, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($rhineAbsoluteBootstrap) -match '^[a-f0-9]{32}$') {
            try { Remove-Item -LiteralPath $rhineAbsoluteBootstrap -Recurse -Force -ErrorAction Stop } catch { }
        }
    }
}
if ($env:RHINE_NO_PAUSE -ne '1') { Read-Host '按回车关闭窗口' | Out-Null }
exit $rhineExit
