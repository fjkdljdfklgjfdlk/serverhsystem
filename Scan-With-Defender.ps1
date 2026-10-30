# Run a regular Microsoft Defender custom scan. No settings are changed.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command Start-MpScan -ErrorAction SilentlyContinue)) {
    throw 'The Microsoft Defender PowerShell module is unavailable on this computer.'
}
Start-MpScan -ScanType CustomScan -ScanPath $PSScriptRoot
Write-Host 'Review Windows Security > Virus & threat protection > Protection history for the results.'
