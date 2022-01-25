$sig = '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);'
$switch = '[DllImport("user32.dll", SetLastError=true)] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);'
Add-Type -MemberDefinition $sig -name NativeMethods -namespace Win32
Add-Type -MemberDefinition $switch -name BlahMethods -namespace Win32

function GetVSCodeWindowHandleByPattern($pattern) {
    return @(Get-Process | Where-Object { $_.MainWindowTitle -like "*$pattern*Visual Studio Code*" }).MainWindowHandle
}

# First supplied arg is the pattern.
$pattern = $args[0]
# Try to find a VSCode window that contains the supplied string.
$handle = GetVSCodeWindowHandleByPattern(pattern)
Write-Output $handle
if ($null -eq $handle) {
    # If we can't find a window that includes the supplied name,
    # look for any VSCode window.
    $handle = GetVSCodeWindowHandleByPattern("")
    if ($null -eq $handle) {
        Write-Output "Failed to find a VSCode window"
        exit 0
    }
}

# Maximise the window and switch to it.
[Win32.NativeMethods]::ShowWindowAsync($handle, 5)
[Win32.BlahMethods]::SwitchToThisWindow($handle, $False)