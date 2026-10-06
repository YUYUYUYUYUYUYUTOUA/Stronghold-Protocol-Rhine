# Windows PowerShell 5.1. UTF-8 with BOM; no service is stopped or started here.
$ErrorActionPreference = 'Stop'
try {
    $sourceRoot = $null
    $targetRoot = $null
    $rollbackRoot = $null
    $checkOnly = $false
    for ($i = 0; $i -lt $args.Count; $i++) {
        $arg = $args[$i]
        if ($arg -eq '--check') { $checkOnly = $true; continue }
        if ($arg -eq '--help') {
            Write-Host '更新旧版.bat [--source 新包目录] [--target 旧包目录] [--check]'
            Write-Host '回退：更新旧版.bat --source 新包目录 --target 旧包目录 --rollback 备份目录'
            exit 0
        }
        if ($arg -notin @('--source', '--target', '--rollback') -or $i + 1 -ge $args.Count) { throw "无法识别或缺少参数：$arg" }
        $i++
        if ($arg -eq '--source') { $sourceRoot = $args[$i] }
        elseif ($arg -eq '--target') { $targetRoot = $args[$i] }
        else { $rollbackRoot = $args[$i] }
    }
    $toolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    if (-not $sourceRoot -and (Test-Path -LiteralPath (Join-Path $toolRoot 'bundle-manifest.json') -PathType Leaf)) { $sourceRoot = $toolRoot }
    Write-Host '莱茵整合包原地更新：保留配置和本地文件，自动备份，不自动停服。' -ForegroundColor Cyan
    Write-Host '请先结束对局并关闭旧目录的服务；开机自启用户需要先停止对应服务。'
    if (-not $sourceRoot) { $sourceRoot = (Read-Host '请输入已完整解压的新整合包目录（内有 bundle-manifest.json）').Trim().Trim('"') }
    if (-not $targetRoot) { $targetRoot = (Read-Host '请输入要更新的旧整合包目录（内有 bundle-manifest.json）').Trim().Trim('"') }
    $sourceRoot = [IO.Path]::GetFullPath($sourceRoot)
    $targetRoot = [IO.Path]::GetFullPath($targetRoot)
    $nodePath = Join-Path $sourceRoot 'runtime\node\node.exe'
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw '新包缺少内置 Node.js，请完整解压 Windows x64 莱茵整合包。' }
    $toolPath = Join-Path $PSScriptRoot 'rhine-bundle-update.mjs'
    if ($rollbackRoot) {
        if ($checkOnly) { throw '回退与 --check 不能同时使用。' }
        & $nodePath $toolPath --target $targetRoot --rollback ([IO.Path]::GetFullPath($rollbackRoot)) | Out-Host
        exit $LASTEXITCODE
    }
    Write-Host '正在核对新包全部文件和旧目录差异，请稍候……'
    & $nodePath $toolPath --source $sourceRoot --target $targetRoot --check | Out-Host
    if ($LASTEXITCODE -ne 0) { throw '检查未通过，没有覆盖文件。请根据上面的冲突路径保留并合并自定义内容。' }
    if ($checkOnly) { exit 0 }
    Write-Host '检查通过，正在备份并更新旧目录……'
    & $nodePath $toolPath --source $sourceRoot --target $targetRoot --apply | Out-Host
    if ($LASTEXITCODE -ne 0) { throw '更新未完成，请查看上面的备份和恢复说明，不要启动未确认的目录。' }
    Write-Host '更新完成。请从原来的旧目录启动游戏，并沿用原来的访问地址。' -ForegroundColor Green
    Write-Host '备份保存在旧目录的 .rhine-updates 中；当前对局不能跨服务重启保留。'
    exit 0
} catch {
    Write-Host ('更新失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
