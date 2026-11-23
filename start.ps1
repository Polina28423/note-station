param([switch]$Release, [switch]$Test)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localCargo = Join-Path $PSScriptRoot '.tools\cargo\bin\cargo.exe'
if (Test-Path -LiteralPath $localCargo) {
    $env:CARGO_HOME = Join-Path $PSScriptRoot '.tools\cargo'
    $env:RUSTUP_HOME = Join-Path $PSScriptRoot '.tools\rustup'
    $cargo = $localCargo
} else {
    $cargo = (Get-Command cargo -ErrorAction Stop).Source
}
if ($Test) { & $cargo test -p note-station-rust }
elseif ($Release) { & $cargo build -p note-station-rust --release }
else { & $cargo run -p note-station-rust }
exit $LASTEXITCODE
