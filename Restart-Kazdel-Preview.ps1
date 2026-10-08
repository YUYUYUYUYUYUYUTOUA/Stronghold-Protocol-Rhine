[CmdletBinding()]
param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$previewRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$previewServer = Join-Path $previewRoot 'server\index.js'
$previewNode = (Get-Command node.exe -ErrorAction Stop).Source
$previewLogRoot = Join-Path $previewRoot '.cache'
$previewUrl = 'http://127.0.0.1:3001'

if (-not (Test-Path -LiteralPath $previewServer -PathType Leaf)) {
    throw 'Run this script from the Kazdel preview checkout.'
}
$previewOwners = @(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
if ($previewOwners.Count -gt 1) { throw 'Port 3001 has multiple owners; nothing was stopped.' }
$previewProcess = $null
if ($previewOwners.Count -eq 1) {
    $previewProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $previewOwners[0])
    if ($null -eq $previewProcess -or $previewProcess.CommandLine -notmatch [regex]::Escape($previewServer) -or $previewProcess.ExecutablePath -ne $previewNode) {
        throw 'Port 3001 belongs to another application; nothing was stopped.'
    }
    $previewState = Invoke-RestMethod ($previewUrl + '/healthz') -TimeoutSec 5
    if ($previewState.ok -ne $true -or $null -eq $previewState.matches -or $null -eq $previewState.sockets -or $previewState.matches -ne 0 -or $previewState.sockets -ne 0) {
        throw 'The preview is in use. Finish games and close connected clients before retrying.'
    }
}
if ($CheckOnly) {
    Write-Host 'CHECK OK: the local Kazdel preview can be refreshed. No process was stopped or started.'
    exit 0
}
if ($null -ne $previewProcess) {
    $previewState = Invoke-RestMethod ($previewUrl + '/healthz') -TimeoutSec 5
    $previewCurrent = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $previewProcess.ProcessId)
    if ($previewState.ok -ne $true -or $previewState.matches -ne 0 -or $previewState.sockets -ne 0 -or $null -eq $previewCurrent -or $previewCurrent.CreationDate -ne $previewProcess.CreationDate -or $previewCurrent.CommandLine -ne $previewProcess.CommandLine) {
        throw 'The preview state changed; nothing was stopped.'
    }
    Stop-Process -Id $previewProcess.ProcessId -ErrorAction Stop
    for ($previewWait = 0; $previewWait -lt 40; $previewWait++) {
        if (-not (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
}
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 3001 is still occupied; no replacement service was started.'
}
New-Item -ItemType Directory -Path $previewLogRoot -Force | Out-Null
$previewLauncher = Start-Process -FilePath $previewNode -ArgumentList 'scripts/launch.mjs','--port','3001','--host','127.0.0.1','--no-open','--no-setup' -WorkingDirectory $previewRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $previewLogRoot 'kazdel-preview.stdout.log') -RedirectStandardError (Join-Path $previewLogRoot 'kazdel-preview.stderr.log') -PassThru
$previewReady = $false
for ($previewWait = 0; $previewWait -lt 40; $previewWait++) {
    Start-Sleep -Milliseconds 500
    try {
        $previewState = Invoke-RestMethod ($previewUrl + '/healthz') -TimeoutSec 2
        if ($previewState.ok -eq $true) { $previewReady = $true; break }
    } catch { }
    if ($previewLauncher.HasExited) { break }
}
if (-not $previewReady) { throw 'Preview did not become healthy. Check .cache/kazdel-preview.stderr.log.' }
Write-Host ('READY: ' + $previewUrl + ' - refresh the browser with Ctrl+F5.')
$previewState | ConvertTo-Json -Compress
Start-Process $previewUrl
