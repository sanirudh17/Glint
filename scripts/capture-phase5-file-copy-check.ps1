param([string]$ArtifactRoot)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$original=[Windows.Forms.Clipboard]::GetDataObject()
$backup=[Windows.Forms.DataObject]::new()
# Materialize all formats before replacing the clipboard. Abort if any cannot
# be backed up, so verification cannot discard an unsupported clipboard format.
if($original){foreach($format in $original.GetFormats($false)){
 $value=$original.GetData($format,$false)
 if($value -is [IO.MemoryStream]){$value=[IO.MemoryStream]::new($value.ToArray())}
 elseif($value -is [ICloneable]){$value=$value.Clone()}
 if($null -ne $value){$backup.SetData($format,$false,$value)}
}}
$results=@()
try{
 foreach($kind in @('gif','video')){
  $path=(& node scripts/capture-phase5-file-copy-check.mjs $ArtifactRoot $kind | Select-Object -Last 1)
  if($LASTEXITCODE -ne 0){throw 'Native file copy failed'}
  if(![Windows.Forms.Clipboard]::ContainsFileDropList()){throw "$kind clipboard is not CF_HDROP"}
  $files=[Windows.Forms.Clipboard]::GetFileDropList()
  if($files.Count -ne 1 -or $files[0] -ne $path){throw "$kind clipboard file path mismatch"}
  if(!(Test-Path -LiteralPath $path -PathType Leaf)){throw 'Clipboard file missing'}
  $results+=[pscustomobject]@{kind=$kind;fileDropList=$true;pathMatches=$true}
  Remove-Item -LiteralPath $path
 }
 $results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $ArtifactRoot 'file-clipboard-result.json') -Encoding utf8
 $results | Format-Table
}finally{if($original){[Windows.Forms.Clipboard]::SetDataObject($backup,$true)}else{[Windows.Forms.Clipboard]::Clear()}}
