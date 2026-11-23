param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('set', 'get', 'status')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$storeDirectory = Join-Path $env:LOCALAPPDATA 'HarnessEval'
$storePath = Join-Path $storeDirectory 'workbuddy-token.xml'

switch ($Action) {
  'set' {
    $secureToken = Read-Host 'Paste the WorkBuddy OAuth access token' -AsSecureString
    if ($secureToken.Length -eq 0) { throw 'The access token cannot be empty.' }
    New-Item -ItemType Directory -Path $storeDirectory -Force | Out-Null
    $credential = [System.Management.Automation.PSCredential]::new('WorkBuddy', $secureToken)
    $credential | Export-Clixml -LiteralPath $storePath -Force
    Write-Output 'WorkBuddy credential stored for the current Windows user with DPAPI.'
  }
  'get' {
    if (-not (Test-Path -LiteralPath $storePath -PathType Leaf)) { exit 2 }
    $credential = Import-Clixml -LiteralPath $storePath
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)
    try {
      $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
      $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($token))
      [Console]::Out.Write($encoded)
    }
    finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
  'status' {
    if (Test-Path -LiteralPath $storePath -PathType Leaf) { Write-Output 'configured' }
    else { Write-Output 'missing' }
  }
}
