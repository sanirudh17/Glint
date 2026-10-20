param([string]$ArtifactRoot)
$ErrorActionPreference='Stop'
$env:GLINT_SCROLL_AUTO='1';$env:GLINT_MANUAL_FOCUS='1';$env:GLINT_PIN_FIXTURE='1'
$taskProcess=Start-Process node -ArgumentList @('scripts/capture-phase5-scroll-check.mjs',('"'+$ArtifactRoot+'"')) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $ArtifactRoot 'measured-scroll.log') -RedirectStandardError (Join-Path $ArtifactRoot 'measured-scroll-error.log')
$null=$taskProcess.Handle # Retain a handle so ExitCode remains available after exit.
$samples=[Collections.Generic.List[object]]::new()
while(!$taskProcess.HasExited){
 $root=Get-CimInstance Win32_Process -Filter "Name='glint.exe'" | Where-Object ExecutablePath -Like '*glint\src-tauri\target\debug\glint.exe' | Select-Object -First 1
 if($root){$sample=& "$PSScriptRoot/phase5-memory.ps1" -RootPid $root.ProcessId;$samples.Add(($sample | ConvertFrom-Json))}
 Start-Sleep -Milliseconds 500;$taskProcess.Refresh()
}
$samples | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $ArtifactRoot 'scroll-memory-samples.json') -Encoding utf8
$taskProcess.WaitForExit()
Get-Content -LiteralPath (Join-Path $ArtifactRoot 'measured-scroll.log')
if($taskProcess.ExitCode -ne 0){Get-Content -LiteralPath (Join-Path $ArtifactRoot 'measured-scroll-error.log');throw "Scroll check exited $($taskProcess.ExitCode)"}
$samples | Measure-Object workingBytes,privateBytes -Maximum | Select-Object Property,Maximum
