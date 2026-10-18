param([Parameter(Mandatory=$true)][int]$OwnerRoot)
$ErrorActionPreference = 'Stop'
$sample = [ordered]@{
  at = [DateTime]::UtcNow.ToString('o')
  ownerRoot = $OwnerRoot
  scope = 'VM TCP state counts and current descendants of the owned diagnostic Node; cumulative process counters, not peaks'
  errors = @()
  optionalErrors = @()
}
try {
  $memory = Get-CimInstance Win32_OperatingSystem
  $sample.memory = @{totalBytes=[long]$memory.TotalVisibleMemorySize * 1024; freeBytes=[long]$memory.FreePhysicalMemory * 1024;
    freeVirtualBytes=[long]$memory.FreeVirtualMemory * 1024; totalVirtualBytes=[long]$memory.TotalVirtualMemorySize * 1024}
} catch { $sample.errors += "memory: $($_.Exception.Message)" }
try {
  $performanceMemory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
  $sample.performanceMemory = @{committedBytes=[long]$performanceMemory.CommittedBytes; commitLimitBytes=[long]$performanceMemory.CommitLimit;
    poolNonpagedBytes=[long]$performanceMemory.PoolNonpagedBytes; poolPagedBytes=[long]$performanceMemory.PoolPagedBytes}
} catch { $sample.optionalErrors += "performance-memory-provider: $($_.Exception.Message)" }
try {
  $all = @(Get-CimInstance Win32_Process)
  $owned = [System.Collections.Generic.HashSet[int]]::new()
  [void]$owned.Add($OwnerRoot)
  do {
    $changed = $false
    foreach ($item in $all) {
      if ($owned.Contains([int]$item.ParentProcessId) -and $owned.Add([int]$item.ProcessId)) { $changed = $true }
    }
  } while ($changed)
  $sample.ownedNodeAndEdge = @($all | Where-Object {
    $owned.Contains([int]$_.ProcessId) -and $_.Name -in @('node.exe', 'msedge.exe', 'chrome.exe')
  } | ForEach-Object {
    @{pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; name=$_.Name; creationDate=$_.CreationDate.ToUniversalTime().ToString('o');
      executablePath=$_.ExecutablePath; commandLine=$_.CommandLine; workingSetBytes=[long]$_.WorkingSetSize;
      privateBytes=[long]$_.PrivatePageCount; handles=[int]$_.HandleCount; threads=[int]$_.ThreadCount;
      kernel100ns=[long]$_.KernelModeTime; user100ns=[long]$_.UserModeTime}
  })
} catch { $sample.errors += "owned-processes: $($_.Exception.Message)" }
try {
  $tcp = @(Get-NetTCPConnection)
  $sample.tcpStateCounts = @($tcp | Group-Object State | ForEach-Object { @{state=$_.Name; count=$_.Count} })
  if ($owned) {
    $sample.ownedTcpStateCounts = @($tcp | Where-Object { $owned.Contains([int]$_.OwningProcess) } |
      Group-Object State | ForEach-Object { @{state=$_.Name; count=$_.Count} })
    $sample.ownedTcpCount = @($tcp | Where-Object { $owned.Contains([int]$_.OwningProcess) }).Count
    $sample.ownedTcpFirst200 = @($tcp | Where-Object { $owned.Contains([int]$_.OwningProcess) } | Select-Object -First 200 |
      ForEach-Object { @{pid=[int]$_.OwningProcess; state=[string]$_.State; localAddress=$_.LocalAddress; localPort=$_.LocalPort;
        remoteAddress=$_.RemoteAddress; remotePort=$_.RemotePort} })
  }
} catch { $sample.errors += "tcp: $($_.Exception.Message)" }
$sample | ConvertTo-Json -Depth 8 -Compress
