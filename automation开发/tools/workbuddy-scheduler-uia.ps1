param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('inspect', 'set-value', 'select', 'read', 'invoke')]
  [string]$Action,
  [string]$SelectorJson,
  [string]$CommandFile,
  [switch]$AllowClipboardFallback
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Emit($Value) {
  $Value | ConvertTo-Json -Compress -Depth 8
}

function Get-Sha256([string]$Text) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

function Get-WorkBuddyWindows {
  $processIds = @(Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if ($processIds.Count -eq 0) { return @() }
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $windows = @()
  for ($index = 0; $index -lt $children.Count; $index++) {
    $element = $children.Item($index)
    try {
      if ($element.Current.ProcessId -in $processIds) { $windows += $element }
    } catch { }
  }
  return ,$windows
}

function Get-Elements($Windows, [int]$MaxElements = 5000, [int]$MaxDepth = 14) {
  $queue = [System.Collections.Generic.Queue[object]]::new()
  foreach ($window in $Windows) { $queue.Enqueue(@($window, 0)) }
  $result = [System.Collections.Generic.List[object]]::new()
  while ($queue.Count -gt 0 -and $result.Count -lt $MaxElements) {
    $entry = $queue.Dequeue()
    $element = $entry[0]
    $depth = [int]$entry[1]
    $result.Add([pscustomobject]@{ Element = $element; Depth = $depth })
    if ($depth -ge $MaxDepth) { continue }
    try {
      $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
      for ($index = 0; $index -lt $children.Count; $index++) {
        $queue.Enqueue(@($children.Item($index), $depth + 1))
      }
    } catch { }
  }
  return ,$result
}

function Get-Selector($Json) {
  if (-not $Json) { throw 'selector_json_required' }
  $selector = $Json | ConvertFrom-Json
  if (-not $selector.automation_id -and -not $selector.name) { throw 'selector_requires_automation_id_or_name' }
  return $selector
}

try {
  $windows = @(Get-WorkBuddyWindows)
  if ($windows.Count -eq 0) {
    Emit @{ status = 'no_accessible_top_level_window'; process_count = @(Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue).Count; controls_visited = 0 }
    exit 4
  }

  $elements = Get-Elements $windows
  if ($Action -eq 'inspect') {
    $labelPattern = '定时任务|自动化|立即运行|运行记录|工作空间|工作区|新建|名称|提示词|重复|单次|模型|专家|技能|连接器|权限|产物|执行|保存|确定|取消'
    $candidates = @()
    foreach ($entry in $elements) {
      $element = $entry.Element
      try {
        $name = [string]$element.Current.Name
        if (-not $name) { continue }
        $labels = @([regex]::Matches($name, $labelPattern) | ForEach-Object { $_.Value } | Select-Object -Unique)
        if ($labels.Count -eq 0) { continue }
        $candidates += @{
          depth = $entry.Depth
          control_type = $element.Current.ControlType.ProgrammaticName
          automation_id = [string]$element.Current.AutomationId
          matched_labels = $labels
        }
      } catch { }
    }
    $visibleWindowCount = @($windows | Where-Object { try { $_.Current.IsOffscreen -eq $false } catch { $false } }).Count
    $status = if ($visibleWindowCount -eq 0) { 'no_visible_workbuddy_window' } elseif ($elements.Count -le $windows.Count) { 'window_has_no_accessible_controls' } else { 'window_controls_found' }
    Emit @{
      status = $status
      window_count = $windows.Count
      visible_window_count = $visibleWindowCount
      controls_visited = $elements.Count
      candidate_count = $candidates.Count
      top_level = @($windows | ForEach-Object { @{ control_type = $_.Current.ControlType.ProgrammaticName; is_offscreen = $_.Current.IsOffscreen; automation_id = [string]$_.Current.AutomationId; has_accessible_name = [bool]$_.Current.Name } })
      candidates = $candidates
    }
    exit 0
  }

  $selector = Get-Selector $SelectorJson
  $targetMatches = @()
  foreach ($entry in $elements) {
    $element = $entry.Element
    try {
      $idMatches = $selector.automation_id -and [string]$element.Current.AutomationId -ceq [string]$selector.automation_id
      $nameMatches = $selector.name -and [string]$element.Current.Name -ceq [string]$selector.name
      $typeMatches = -not $selector.control_type -or $element.Current.ControlType.ProgrammaticName -ceq [string]$selector.control_type
      if (($idMatches -or $nameMatches) -and $typeMatches) { $targetMatches += $element }
    } catch { }
  }
  if ($targetMatches.Count -ne 1) {
    Emit @{ status = 'selector_not_unique'; match_count = $targetMatches.Count; controls_visited = $elements.Count }
    exit 5
  }
  $target = $targetMatches[0]
  if ($target.Current.IsOffscreen -ne $false) {
    Emit @{ status = 'target_visibility_unconfirmed'; control_type = $target.Current.ControlType.ProgrammaticName }
    exit 6
  }
  if ($target.Current.IsEnabled -ne $true) {
    Emit @{ status = 'target_not_enabled'; control_type = $target.Current.ControlType.ProgrammaticName }
    exit 6
  }

  if ($Action -eq 'read') {
    $pattern = $null
    $text = if ($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { [string]$pattern.Current.Value } else { [string]$target.Current.Name }
    Emit @{ status = 'read'; control_type = $target.Current.ControlType.ProgrammaticName; text = $text }
    exit 0
  }

  if ($Action -eq 'invoke') {
    if ($target.Current.ControlType.ProgrammaticName -notin @('ControlType.Button', 'ControlType.Hyperlink', 'ControlType.MenuItem', 'ControlType.ListItem')) {
      Emit @{ status = 'unsupported_invoke_control'; control_type = $target.Current.ControlType.ProgrammaticName }
      exit 6
    }
    $pattern = $null
    if (-not $target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
      Emit @{ status = 'invoke_pattern_unavailable'; control_type = $target.Current.ControlType.ProgrammaticName }
      exit 6
    }
    $pattern.Invoke()
    Emit @{ status = 'invoked'; control_type = $target.Current.ControlType.ProgrammaticName; automation_id = [string]$target.Current.AutomationId }
    exit 0
  }

  if ($Action -eq 'select') {
    if (-not $CommandFile -or -not (Test-Path -LiteralPath $CommandFile -PathType Leaf)) { throw 'command_file_required' }
    $command = Get-Content -LiteralPath $CommandFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $command.value -or $command.value -isnot [string]) { throw 'command_value_must_be_string' }
    $selected = $false
    if ($target.Current.ControlType.ProgrammaticName -eq 'ControlType.ComboBox') {
      $valuePattern = $null
      if ($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and -not $valuePattern.Current.IsReadOnly) {
        $valuePattern.SetValue([string]$command.value)
        $selected = $true
      }
    }
    if (-not $selected) {
      $selectionPattern = $null
      if ($target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$selectionPattern)) {
        $selectionPattern.Select()
        $selected = $true
      }
    }
    if (-not $selected) {
      Emit @{ status = 'selection_pattern_unavailable'; control_type = $target.Current.ControlType.ProgrammaticName }
      exit 6
    }
    $readPattern = $null
    $readback = if ($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$readPattern)) { [string]$readPattern.Current.Value } else { [string]$target.Current.Name }
    $matched = $readback -ceq [string]$command.value
    Emit @{ status = $(if ($matched) { 'selected_and_verified' } else { 'selection_readback_mismatch' }); control_type = $target.Current.ControlType.ProgrammaticName; matched = $matched }
    if (-not $matched) { exit 9 }
    exit 0
  }

  if (-not $CommandFile -or -not (Test-Path -LiteralPath $CommandFile -PathType Leaf)) { throw 'command_file_required' }
  $command = Get-Content -LiteralPath $CommandFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($null -eq $command.value -or $command.value -isnot [string]) { throw 'command_value_must_be_string' }
  if ($target.Current.ControlType.ProgrammaticName -notin @('ControlType.Edit', 'ControlType.Document', 'ControlType.ComboBox')) {
    Emit @{ status = 'unsupported_value_control'; control_type = $target.Current.ControlType.ProgrammaticName }
    exit 7
  }

  $value = [string]$command.value
  $valueSha = Get-Sha256 $value
  $valuePattern = $null
  $usedMethod = $null
  if ($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and -not $valuePattern.Current.IsReadOnly) {
    $valuePattern.SetValue($value)
    $usedMethod = 'uia_value_pattern'
  } else {
    if (-not $AllowClipboardFallback) {
      Emit @{ status = 'value_pattern_unavailable'; control_type = $target.Current.ControlType.ProgrammaticName }
      exit 7
    }
    Add-Type -AssemblyName System.Windows.Forms
    $clipboardData = [System.Windows.Forms.Clipboard]::GetDataObject()
    $clipboardFormats = if ($clipboardData) { @($clipboardData.GetFormats($false)) } else { @() }
    $allowedClipboardFormats = @('Text', 'UnicodeText', 'StringFormat', 'Locale')
    if (@($clipboardFormats | Where-Object { $_ -notin $allowedClipboardFormats }).Count -gt 0) {
      Emit @{ status = 'clipboard_contains_non_text_data'; preserved = $true }
      exit 7
    }
    $hadClipboardText = [System.Windows.Forms.Clipboard]::ContainsText()
    $previousClipboardText = if ($hadClipboardText) { [System.Windows.Forms.Clipboard]::GetText() } else { $null }
    $target.SetFocus()
    try {
      [System.Windows.Forms.Clipboard]::SetText($value)
      [System.Windows.Forms.SendKeys]::SendWait('^a')
      [System.Windows.Forms.SendKeys]::SendWait('^v')
      Start-Sleep -Milliseconds 150
      $usedMethod = 'clipboard_paste'
    } finally {
      if ($hadClipboardText) { [System.Windows.Forms.Clipboard]::SetText($previousClipboardText) }
      else { [System.Windows.Forms.Clipboard]::Clear() }
    }
  }

  $verifyPattern = $null
  $readback = $null
  if ($target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$verifyPattern)) {
    $readback = [string]$verifyPattern.Current.Value
  }
  if ($null -eq $readback) {
    Emit @{ status = 'value_readback_unavailable'; method = $usedMethod; value_chars = $value.Length; value_sha256 = $valueSha }
    exit 8
  }
  $readbackSha = Get-Sha256 $readback
  $matched = $readback -ceq $value
  Emit @{ status = $(if ($matched) { 'value_set_and_verified' } else { 'value_readback_mismatch' }); method = $usedMethod; value_chars = $value.Length; value_sha256 = $valueSha; readback_sha256 = $readbackSha; matched = $matched }
  if (-not $matched) { exit 9 }
  exit 0
} catch {
  Emit @{ status = 'helper_error'; error_type = $_.Exception.GetType().Name; message = $_.Exception.Message }
  exit 10
}
