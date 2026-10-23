$ErrorActionPreference = 'Stop'
$lock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'actionlint-version.json') -Raw | ConvertFrom-Json
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$destination = Join-Path $repo ('output/tools/actionlint/' + $lock.version)
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$archive = Join-Path $destination 'actionlint.zip'
$executable = Join-Path $destination 'actionlint.exe'
if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -Uri $lock.url -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.archiveSha256) {
  throw 'actionlint archive SHA-256 mismatch; preserve the bad download for diagnosis'
}
if (-not (Test-Path -LiteralPath $executable)) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
    $entry = $zip.GetEntry('actionlint.exe')
    if (-not $entry) { throw 'Verified archive has no actionlint.exe' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $executable)
  } finally { $zip.Dispose() }
}
if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.executableSha256) {
  throw 'actionlint executable SHA-256 mismatch'
}
Write-Output ('Verified actionlint ' + $lock.version + ': ' + $executable)
