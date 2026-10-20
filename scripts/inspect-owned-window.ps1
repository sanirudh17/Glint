param([int]$TargetPid,[switch]$Pin)
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class GlintWindowRead {
 public delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c, IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int hgt,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder t,int n);
}
'@
$owned=[Collections.Generic.List[object]]::new()
$callback=[GlintWindowRead+Callback]{param($h,$p) $owner=0;[void][GlintWindowRead]::GetWindowThreadProcessId($h,[ref]$owner);if($owner -eq $TargetPid){$title=[Text.StringBuilder]::new(512);[void][GlintWindowRead]::GetWindowText($h,$title,512);if($Pin -and $title.ToString() -eq 'Glint manual scroll check'){[void][GlintWindowRead]::SetWindowPos($h,[IntPtr]::new(-1),0,0,0,0,0x0013)};$owned.Add([pscustomobject]@{hwnd=$h.ToInt64();title=$title.ToString();visible=[GlintWindowRead]::IsWindowVisible($h);minimized=[GlintWindowRead]::IsIconic($h);foreground=($h -eq [GlintWindowRead]::GetForegroundWindow())})};return $true}
[void][GlintWindowRead]::EnumWindows($callback,[IntPtr]::Zero)
ConvertTo-Json -InputObject @($owned.ToArray()) -Compress
