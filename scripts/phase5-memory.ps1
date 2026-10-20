param([int]$RootPid)
$all=@(Get-CimInstance Win32_Process)
$root=$all | Where-Object ProcessId -eq $RootPid
if(!$root){throw 'Root process no longer running'}
$members=[Collections.Generic.HashSet[int]]::new();[void]$members.Add($RootPid)
do{$changed=$false;foreach($p in $all){if($members.Contains([int]$p.ParentProcessId) -and !$members.Contains([int]$p.ProcessId)){
 $parent=$all | Where-Object ProcessId -eq $p.ParentProcessId | Select-Object -First 1
 if($parent -and $p.CreationDate -ge $parent.CreationDate){[void]$members.Add([int]$p.ProcessId);$changed=$true}
}}}while($changed)
$working=0L;$private=0L;$count=0
foreach($member in $members){$process=Get-Process -Id $member -ErrorAction SilentlyContinue;if($process){$working+=$process.WorkingSet64;$private+=$process.PrivateMemorySize64;$count++}}
[pscustomobject]@{pid=$RootPid;processes=$count;workingBytes=$working;privateBytes=$private;time=(Get-Date).ToString('o')} | ConvertTo-Json -Compress
