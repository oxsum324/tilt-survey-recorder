param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9_-]*$')][string]$Name,
  [Parameter(Mandatory = $true)][string]$Executable,
  [string[]]$Arguments = @()
)

$ErrorActionPreference = 'Stop'
$root = $env:TILT_CI_EVIDENCE_ROOT
if (-not $root -or -not (Test-Path -LiteralPath (Join-Path $root 'bootstrap.json'))) {
  throw 'CI evidence must be initialized before running commands'
}
$commands = Join-Path $root 'commands'
New-Item -ItemType Directory -Path $commands -Force | Out-Null
$log = Join-Path $commands ($Name + '.log')
$receipt = Join-Path $commands ($Name + '.json')
if ((Test-Path -LiteralPath $log) -or (Test-Path -LiteralPath $receipt)) {
  throw "Preserve previous command evidence: $Name"
}
$utf8 = [Text.UTF8Encoding]::new($false)
$record = [ordered]@{
  name = $Name
  executable = $Executable
  arguments = $Arguments
  commit = $env:GITHUB_SHA
  scope = $env:TILT_CI_EVIDENCE_SCOPE
  startedUtc = [DateTime]::UtcNow.ToString('o')
  endedUtc = $null
  status = 'running'
  exitCode = $null
  error = $null
}
[IO.File]::WriteAllText($log, '', $utf8)
[IO.File]::WriteAllText($receipt, ($record | ConvertTo-Json -Depth 8), $utf8)
$code = 1
try {
  # Resolve before invocation so a missing command cannot leave LASTEXITCODE at zero.
  $command = Get-Command $Executable -CommandType Application, ExternalScript -ErrorAction Stop | Select-Object -First 1
  $global:LASTEXITCODE = 0
  # Native stderr belongs in the evidence; it must not abort capture before the exit code.
  $ErrorActionPreference = 'Continue'
  $PSNativeCommandUseErrorActionPreference = $false
  & $command.Source @Arguments 2>&1 | ForEach-Object {
    $line = $_.ToString()
    [IO.File]::AppendAllText($log, $line + [Environment]::NewLine, $utf8)
    Write-Host $line
  }
  $code = $LASTEXITCODE
} catch {
  $code = 1
  $record.error = $_.ToString()
  [IO.File]::AppendAllText($log, $record.error + [Environment]::NewLine, $utf8)
  Write-Host $record.error
} finally {
  $record.endedUtc = [DateTime]::UtcNow.ToString('o')
  $record.exitCode = $code
  $record.status = if ($code -eq 0) { 'success' } else { 'failure' }
  $record.logSha256 = (Get-FileHash -LiteralPath $log -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($receipt, ($record | ConvertTo-Json -Depth 8), $utf8)
}
exit $code
