import { spawnSync } from 'node:child_process';

const powershellProbe = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
} catch {
  [pscustomobject]@{ kind = 'summary'; status = 'unavailable'; reason = 'uia_assemblies_unavailable' } | ConvertTo-Json -Compress
  exit 2
}
$processes = @(Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue)
$processIds = @($processes | ForEach-Object { $_.Id })
if ($processIds.Count -eq 0) {
  [pscustomobject]@{ kind = 'summary'; status = 'no_process'; reason = 'workbuddy_process_not_found' } | ConvertTo-Json -Compress
  exit 3
}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$labelPattern = '定时任务|自动化|立即运行|运行记录|工作空间|新建|模型|专家|技能|连接器|权限|产物|执行'
$seenWindows = 0
$matchedControls = 0
$totalVisited = 0
$traversalTruncated = $false
for ($windowIndex = 0; $windowIndex -lt $windows.Count; $windowIndex++) {
  $window = $windows.Item($windowIndex)
  $processId = $window.Current.ProcessId
  if ($processId -notin $processIds) { continue }
  $seenWindows++
  $queue = [System.Collections.Generic.Queue[object]]::new()
  $queue.Enqueue(@($window, 0))
  $visited = 0
  while ($queue.Count -gt 0 -and $visited -lt 1200) {
    $entry = $queue.Dequeue()
    $element = $entry[0]
    $depth = [int]$entry[1]
    $visited++
    $totalVisited++
    try {
      $name = [string]$element.Current.Name
      if ($name -and $name -match $labelPattern) {
        $labels = [regex]::Matches($name, $labelPattern) | ForEach-Object { $_.Value } | Select-Object -Unique
        [pscustomobject]@{
          kind = 'candidate_control'
          depth = $depth
          control_type = $element.Current.ControlType.ProgrammaticName
          automation_id = [string]$element.Current.AutomationId
          matched_labels = @($labels)
        } | ConvertTo-Json -Compress
        $matchedControls++
      }
    } catch { }
    if ($depth -ge 8) { continue }
    try {
      $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
      for ($childIndex = 0; $childIndex -lt $children.Count; $childIndex++) {
        $queue.Enqueue(@($children.Item($childIndex), $depth + 1))
      }
    } catch { }
  }
  if ($visited -ge 1200) { $traversalTruncated = $true }
}
$status = if ($seenWindows -eq 0) { 'no_accessible_top_level_window' } elseif ($matchedControls -eq 0) { 'no_candidate_controls' } else { 'candidate_controls_found' }
[pscustomobject]@{
  kind = 'summary'
  status = $status
  workbuddy_process_count = $processIds.Count
  accessible_top_level_window_count = $seenWindows
  visited_control_count = $totalVisited
  candidate_control_count = $matchedControls
  traversal_truncated = $traversalTruncated
} | ConvertTo-Json -Compress
if ($seenWindows -eq 0) { exit 4 }
`;

const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', powershellProbe], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 15000,
  maxBuffer: 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.error) {
  console.log(JSON.stringify({ kind: 'summary', status: 'probe_failed', reason: result.error.code ?? 'powershell_error' }));
  process.exitCode = 5;
} else {
  process.exitCode = result.status ?? 5;
}
