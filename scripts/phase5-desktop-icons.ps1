param([int]$Visibility=-1)
# Validation helper. Caller must restore the recorded prior visibility in finally.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class GlintDesktopCheck {
 public delegate bool Callback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback c,IntPtr p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p,IntPtr a,string c,string t);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 public static void Scan(){EnumWindows(Find,IntPtr.Zero);}
 public static IntPtr Icons;
 public static bool Find(IntPtr h,IntPtr p){var v=FindWindowEx(h,IntPtr.Zero,"SHELLDLL_DefView",null);if(v!=IntPtr.Zero){Icons=FindWindowEx(v,IntPtr.Zero,"SysListView32",null);if(Icons!=IntPtr.Zero)return false;}return true;}
}
'@
[GlintDesktopCheck]::Scan()
if([GlintDesktopCheck]::Icons -eq [IntPtr]::Zero){throw 'Desktop icon view not found'}
if($Visibility -ge 0){$show=if($Visibility -eq 1){8}else{0};[void][GlintDesktopCheck]::ShowWindow([GlintDesktopCheck]::Icons,$show)}
[GlintDesktopCheck]::IsWindowVisible([GlintDesktopCheck]::Icons).ToString().ToLowerInvariant()
