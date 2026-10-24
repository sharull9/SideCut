$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Run installer acceptance on Windows.' }
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $workspace 'apps/desktop/release'
$installer = Get-ChildItem -LiteralPath $release -Filter 'SideCut-*-win-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw 'Build the Windows NSIS installer first.' }
$uninstallRoots = @('HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall', 'HKLM:/Software/Microsoft/Windows/CurrentVersion/Uninstall', 'HKLM:/Software/WOW6432Node/Microsoft/Windows/CurrentVersion/Uninstall')
$existing = Get-ChildItem $uninstallRoots -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName -eq 'SideCut' }
if ($existing) { throw 'An existing SideCut installation is registered. Installer acceptance will not replace it.' }
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('sidecut-install-' + [guid]::NewGuid().ToString('N'))
$installPath = Join-Path $testRoot 'SideCut 侧剪'
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  $installed = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installPath") -WindowStyle Hidden -Wait -PassThru
  if ($installed.ExitCode -ne 0) { throw "Installer exited $($installed.ExitCode)." }
  $executable = Join-Path $installPath 'SideCut.exe'
  if (-not (Test-Path -LiteralPath $executable)) { throw 'Installed executable was not found.' }
  $cli = Join-Path $installPath 'resources/cli/sidecut.cmd'
  $help = & $cli --help
  if ($LASTEXITCODE -ne 0 -or ($help -join "`n") -notmatch 'Usage:') { throw 'Installed CLI launcher failed.' }
  Push-Location $workspace
  try { & vp exec node scripts/verify-packaged.mjs --executable $executable; if ($LASTEXITCODE -ne 0) { throw 'Installed app verification failed.' } }
  finally { Pop-Location }
} finally {
  $uninstaller = Join-Path $installPath 'Uninstall SideCut.exe'
  if (Test-Path -LiteralPath $uninstaller) {
    $removed = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$installPath") -WindowStyle Hidden -Wait -PassThru
    if ($removed.ExitCode -ne 0) { throw "Uninstaller exited $($removed.ExitCode)." }
  }
  $resolvedTarget = [IO.Path]::GetFullPath($testRoot)
  $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolvedTarget.StartsWith($expectedParent, [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($resolvedTarget)).StartsWith('sidecut-install-')) { throw 'Temporary install cleanup target is invalid.' }
  Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}
$remaining = Get-ChildItem $uninstallRoots -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName -eq 'SideCut' }
if ($remaining) { throw 'The test installation left a SideCut registration behind.' }
$resultPath = Join-Path $release 'installed-smoke-win32-x64.json'
$result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
$result | Add-Member -NotePropertyName installation -NotePropertyValue @{ installer = $installer.Name; sha256 = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); unicodeSpacePath = $true; launcher = $true; uninstalled = $true } -Force
$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $resultPath -Encoding utf8
