param([int]$Interval = 5)
# Prints the foreground window (process name + title, base64 UTF-8) whenever it changes.
# Started and stopped by the app only when the user turns on "창 사용 기록" in settings.
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class HnFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$last = ''
while ($true) {
  $h = [HnFg]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][HnFg]::GetWindowText($h, $sb, 512)
  $procId = 0
  [void][HnFg]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ''
  try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sb.ToString()))
  $line = "$name`t$b64"
  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
  Start-Sleep -Seconds $Interval
}
