# This copied helper runs outside the installation; keep UTF-8 with BOM.
param([string]$RhineTarget, [string]$RhineCache, [switch]$CheckOnly, [switch]$DownloadOnly)
$ErrorActionPreference = 'Stop'
$rhineMutex = $null
$rhineOwnsMutex = $false
try {
    # Use an OS mutex outside the installation, so a second double-click cannot update
    # this target concurrently and an interrupted run leaves no stale lock file.
    $rhineCanonicalTarget = [IO.Path]::GetFullPath($RhineTarget).TrimEnd('\').ToLowerInvariant()
    $rhineHash = [Security.Cryptography.SHA256]::Create()
    try {
        $rhineTargetHash = [BitConverter]::ToString($rhineHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($rhineCanonicalTarget))).Replace('-', '').ToLowerInvariant()
    } finally { $rhineHash.Dispose() }
    $rhineMutex = New-Object Threading.Mutex($false, ('Local\StrongholdProtocolRhineUpdate-' + $rhineTargetHash))
    try { $rhineOwnsMutex = $rhineMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $rhineOwnsMutex = $true }
    if (-not $rhineOwnsMutex) { throw '这个安装目录已有更新窗口正在运行，请等待它完成，不要重复打开。' }
    $rhineCli = @((Join-Path $PSScriptRoot 'rhine-online-update.mjs'), '--target', $RhineTarget, '--cache', $RhineCache)
    if ($CheckOnly) { $rhineCli += '--check' }
    if ($DownloadOnly) { $rhineCli += '--download-only' }
    & (Join-Path $PSScriptRoot 'node.exe') @rhineCli | Out-Host
    exit $LASTEXITCODE
} catch {
    Write-Host ('更新失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    if ($rhineOwnsMutex) { $rhineMutex.ReleaseMutex() }
    if ($rhineMutex) { $rhineMutex.Dispose() }
}
