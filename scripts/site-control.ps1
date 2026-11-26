[CmdletBinding()]
param(
  [ValidateSet('menu', 'start', 'stop', 'restart', 'status')]
  [string]$Action = 'menu',
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
$ProjectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$EntryPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot 'scripts\start.mjs'))
$BuildPath = Join-Path $ProjectRoot '.output\server\index.mjs'
$StateDir = Join-Path $ProjectRoot '.data'
$StateFile = Join-Path $StateDir 'site-manager.json'
$LockFile = Join-Path $StateDir 'site-manager.lock'
$LogDir = Join-Path $StateDir 'logs'

# 在同一个 Windows 进程句柄上核验创建时间并终止，避免 PID 已被其他进程复用。
if (-not ('NightLibrary.ProcessHandle' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;

namespace NightLibrary {
  public static class ProcessHandle {
    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime { public uint Low; public uint High; }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessTimes(IntPtr handle, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr handle, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static string Created(IntPtr handle) {
      FileTime creation, exit, kernel, user;
      if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
      ulong value = ((ulong)creation.High << 32) | creation.Low;
      return value.ToString(CultureInfo.InvariantCulture);
    }
    public static string CreationStamp(int processId) {
      IntPtr handle = OpenProcess(0x1000, false, processId);
      if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { return Created(handle); } finally { CloseHandle(handle); }
    }
    public static void StopIfSame(int processId, string expectedCreation) {
      IntPtr handle = OpenProcess(0x00101001, false, processId);
      if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        if (Created(handle) != expectedCreation) throw new InvalidOperationException("Process identity changed");
        uint state = WaitForSingleObject(handle, 0);
        if (state == 0) return;
        if (state != 258) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!TerminateProcess(handle, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (WaitForSingleObject(handle, 10000) != 0) throw new InvalidOperationException("Process did not exit");
      } finally { CloseHandle(handle); }
    }
  }
}
'@
}

function Ensure-ManagementDirectory {
  if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) {
    New-Item -ItemType Directory -Path $StateDir -ErrorAction Stop | Out-Null
  }
}

function Invoke-WithLock([scriptblock]$Work) {
  Ensure-ManagementDirectory
  try {
    $lock = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  } catch {
    throw '另一个管理操作正在进行，请稍后重试。'
  }
  try { & $Work } finally { $lock.Dispose() }
}

function Find-Node {
  $candidates = New-Object 'System.Collections.Generic.List[string]'
  if ($env:NIGHT_LIBRARY_NODE) {
    $candidates.Add($env:NIGHT_LIBRARY_NODE)
  } else {
    $onPath = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($onPath -and $onPath.Source) { $candidates.Add($onPath.Source) }
    if ($env:USERPROFILE) {
      $candidates.Add((Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'))
    }
  }
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    try {
      # Do not truncate the native pipeline: that can kill node.exe mid-run and
      # produce a bogus $LASTEXITCODE. Capture it fully, then read the first line.
      $rawOutput = @(& $candidate --version 2>$null)
      $exitCode = $LASTEXITCODE
      $rawVersion = $rawOutput | Where-Object { $_ } | Select-Object -First 1
      if ($exitCode -ne 0 -or -not $rawVersion) { continue }
      $parsedVersion = $null
      if (-not [version]::TryParse(([string]$rawVersion).TrimStart('v'), [ref]$parsedVersion)) { continue }
      if (($parsedVersion.Major -eq 24 -and $parsedVersion.Minor -ge 15) -or $parsedVersion.Major -ge 26) {
        return [System.IO.Path]::GetFullPath($candidate)
      }
    } catch { continue }
  }
  throw '未找到可用的 Node.js。请安装 Node.js 24.15 或更新的 24.x 版本，再重试。'
}

function Test-AllowedAddress([string]$Address) {
  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$parsed) -or $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or $parsed.ToString() -ne $Address) { return $false }
  $octets = $Address.Split('.') | ForEach-Object { [int]$_ }
  return $Address -eq '127.0.0.1' -or $octets[0] -eq 10 -or ($octets[0] -eq 192 -and $octets[1] -eq 168) -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31)
}

function Read-SiteConfig([string]$NodePath) {
  # 与 scripts/start.mjs 相同：先继承环境变量，再通过 Node 读取项目根目录的 .env。
  $program = @'
const fs = require('node:fs');
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const host = process.env.NITRO_HOST || '127.0.0.1';
const port = process.env.NITRO_PORT || '3000';
console.log(JSON.stringify({ host, port, unix: Boolean(process.env.NITRO_UNIX_SOCKET), tls: Boolean(process.env.NITRO_SSL_CERT || process.env.NITRO_SSL_KEY) }));
'@
  $lines = @(& $NodePath -e $program 2>&1)
  if ($LASTEXITCODE -ne 0) { throw '无法读取站点配置，请检查 .env 格式。' }
  try { $value = ($lines -join "`n") | ConvertFrom-Json } catch { throw '无法读取站点配置，请检查 .env 格式。' }
  if ($value.unix -or $value.tls) { throw '此管理脚本仅支持 HTTP 和 TCP；请先移除 NITRO_UNIX_SOCKET / NITRO_SSL_CERT / NITRO_SSL_KEY 设置。' }
  $address = [string]$value.host
  if (-not (Test-AllowedAddress $address)) { throw 'NITRO_HOST 必须是 127.0.0.1 或本机私有局域网 IPv4，不能使用 0.0.0.0。' }
  $number = 0
  if (-not [int]::TryParse([string]$value.port, [ref]$number) -or $number -lt 1 -or $number -gt 65535) { throw 'NITRO_PORT 必须是 1–65535 之间的端口。' }
  return [pscustomobject]@{ Address = $address; Port = $number; Url = "http://${address}:$number" }
}

function Read-ManagerState {
  if (-not (Test-Path -LiteralPath $StateFile -PathType Leaf)) { return $null }
  try { $state = [System.IO.File]::ReadAllText($StateFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json } catch { throw '管理记录无法读取。为避免误操作，未停止任何进程；请检查 .data\site-manager.json。' }
  $number = 0
  if ($state.version -ne 1 -or -not [int]::TryParse([string]$state.processId, [ref]$number) -or $number -lt 1 -or
      [string]$state.instanceId -notmatch '^[a-f0-9]{32}$' -or [string]$state.created -notmatch '^\d+$' -or
      -not $state.executable -or -not $state.entry -or -not $state.url) {
    throw '管理记录无效。为避免误操作，未停止任何进程；请检查 .data\site-manager.json。'
  }
  $uri = $null
  $savedPort = 0
  if (-not [uri]::TryCreate([string]$state.url, [System.UriKind]::Absolute, [ref]$uri) -or
      -not [int]::TryParse([string]$state.port, [ref]$savedPort) -or $savedPort -lt 1 -or $savedPort -gt 65535 -or
      -not (Test-AllowedAddress ([string]$state.address)) -or $uri.Scheme -ne 'http' -or
      $uri.Host -ne [string]$state.address -or $uri.Port -ne $savedPort -or $uri.AbsolutePath -ne '/' -or
      $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
    throw '管理记录中的站点地址无效。为避免误操作，未停止任何进程。'
  }
  return $state
}

function Resolve-ManagedProcess($State) {
  if (-not $State) { return [pscustomobject]@{ Kind = 'stopped'; Record = $null } }
  $managedId = [int]$State.processId
  try { $process = Get-CimInstance Win32_Process -Filter "ProcessId = $managedId" -ErrorAction Stop } catch { throw '无法核验管理进程，请确认当前账户有权查看进程。未停止任何程序。' }
  if (-not $process) { return [pscustomobject]@{ Kind = 'stopped'; Record = $State } }
  try { $stamp = [NightLibrary.ProcessHandle]::CreationStamp($managedId) } catch { throw '无法核验进程创建时间，未停止任何程序。' }
  $line = [string]$process.CommandLine
  $sameEntry = [string]::Equals([string]$State.entry, $EntryPath, [StringComparison]::OrdinalIgnoreCase)
  $sameExecutable = $process.ExecutablePath -and [string]::Equals([string]$State.executable, [string]$process.ExecutablePath, [StringComparison]::OrdinalIgnoreCase)
  $hasEntry = $line.IndexOf(('"' + $EntryPath + '"'), [StringComparison]::OrdinalIgnoreCase) -ge 0
  $tokenPattern = '(?:^|\s)--night-library-instance=' + [regex]::Escape([string]$State.instanceId) + '(?:\s|$)'
  if (-not $sameEntry -or -not $sameExecutable -or $stamp -ne [string]$State.created -or -not $hasEntry -or $line -notmatch $tokenPattern) {
    return [pscustomobject]@{ Kind = 'mismatch'; Record = $State }
  }
  return [pscustomobject]@{ Kind = 'running'; Record = $State }
}

function Test-Port([string]$Address, [int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient([System.Net.Sockets.AddressFamily]::InterNetwork)
  try {
    $pending = $client.BeginConnect($Address, $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(500)) { return $false }
    try { $client.EndConnect($pending); return $true } catch { return $false }
  } finally { $client.Close() }
}

function Assert-PortAvailable($Config) {
  $addresses = New-Object 'System.Collections.Generic.List[string]'
  $addresses.Add('127.0.0.1')
  if (-not $addresses.Contains($Config.Address)) { $addresses.Add($Config.Address) }
  try {
    foreach ($item in @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop)) {
      $candidate = [string]$item.IPAddress
      if ($item.AddressState -eq 'Preferred' -and $candidate -ne '127.0.0.1' -and $candidate -notlike '169.254.*' -and -not $addresses.Contains($candidate)) {
        $addresses.Add($candidate)
      }
    }
  } catch { throw '无法检查本机网卡和端口，未启动服务。' }
  foreach ($address in $addresses) {
    if (Test-Port $address $Config.Port) {
      throw "端口 $($Config.Port) 已有程序使用（$address）。如果是以前手动启动的影视库，请先关闭旧实例；脚本不会停止或接管其他程序。"
    }
  }
}

function Test-Ready([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$Url/api/library" -TimeoutSec 2
    if ($response.StatusCode -ne 200) { return $false }
    $body = $response.Content | ConvertFrom-Json
    return $null -ne $body.items
  } catch { return $false }
}

function Get-ConnectedOwner([string]$Address, [int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient([System.Net.Sockets.AddressFamily]::InterNetwork)
  try {
    $client.Connect($Address, $Port)
    $localPort = $client.Client.LocalEndPoint.Port
    $serverAddress = $client.Client.RemoteEndPoint.Address.ToString()
    $connections = @(Get-NetTCPConnection -LocalPort $Port -RemotePort $localPort -ErrorAction Stop | Where-Object { $_.LocalAddress -eq $serverAddress })
    if ($connections.Count -ne 1) { throw '无法唯一确认端口所属进程。' }
    return [int]$connections[0].OwningProcess
  } finally { $client.Close() }
}

function Test-ManagedReady($Record) {
  if (-not (Test-Ready ([string]$Record.url))) { return $false }
  try { return (Get-ConnectedOwner ([string]$Record.address) ([int]$Record.port)) -eq [int]$Record.processId } catch { return $false }
}

function Open-Site([string]$Url) {
  if ($NoBrowser) { return }
  try { Start-Process -FilePath $Url | Out-Null } catch { Write-Host '无法自动打开浏览器，请手动访问上方地址。' }
}

function Show-Status {
  $resolved = Resolve-ManagedProcess (Read-ManagerState)
  if ($resolved.Kind -eq 'running') {
    Write-Host "状态：运行中  $($resolved.Record.url)"
    if (-not (Test-ManagedReady $resolved.Record)) { Write-Host '提示：进程仍在运行，但网站未通过响应和端口归属检查；可查看下方日志。' }
    Write-Host "输出日志：$($resolved.Record.stdout)"
    Write-Host "错误日志：$($resolved.Record.stderr)"
  } elseif ($resolved.Kind -eq 'mismatch') {
    Write-Host '状态：管理记录与当前进程不匹配。为安全起见不会停止该进程。'
  } else {
    Write-Host '状态：脚本管理的网站未运行。'
    try {
      $node = Find-Node
      $config = Read-SiteConfig $node
      if ((Test-Port $config.Address $config.Port) -or (Test-Port '127.0.0.1' $config.Port)) {
        Write-Host "提示：端口 $($config.Port) 已有其他程序运行；脚本不会停止或接管它。"
      }
    } catch { Write-Host '提示：未能检查站点配置或端口。' }
  }
}

function Start-Site {
  $resolved = Resolve-ManagedProcess (Read-ManagerState)
  if ($resolved.Kind -eq 'running') {
    if (-not (Test-ManagedReady $resolved.Record)) { throw '管理进程仍在运行，但网站未通过响应和端口归属检查。请先查看状态和日志，或停止后重试。' }
    Write-Host "网站已经运行：$($resolved.Record.url)"
    Open-Site ([string]$resolved.Record.url)
    return
  }
  if (-not (Test-Path -LiteralPath $BuildPath -PathType Leaf)) { throw '未找到生产构建。请先在项目目录安装依赖并运行 pnpm build。' }
  $node = Find-Node
  $config = Read-SiteConfig $node
  Assert-PortAvailable $config
  $localAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' } | ForEach-Object { [string]$_.IPAddress })
  if ($config.Address -ne '127.0.0.1' -and $localAddresses -notcontains $config.Address) {
    $hint = ($localAddresses | Where-Object { $_ -ne '127.0.0.1' -and $_ -notlike '169.254.*' }) -join '、'
    throw "配置的监听地址 $($config.Address) 不在本机网卡上（IP 可能已变化）。当前可用地址：$(if ($hint) { $hint } else { '无' })。请修改 .env 的 NITRO_HOST 与 NUXT_LIBRARY_ALLOWED_ORIGINS 后重试。"
  }
  if (-not (Test-Path -LiteralPath $LogDir -PathType Container)) { New-Item -ItemType Directory -Path $LogDir -ErrorAction Stop | Out-Null }
  $instanceId = [guid]::NewGuid().ToString('N')
  $stdout = Join-Path $LogDir "site-$instanceId.out.log"
  $stderr = Join-Path $LogDir "site-$instanceId.err.log"
  $argument = @(('"' + $EntryPath + '"'), "--night-library-instance=$instanceId")
  $child = Start-Process -FilePath $node -ArgumentList $argument -WorkingDirectory $ProjectRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
  try { $created = [NightLibrary.ProcessHandle]::CreationStamp($child.Id) } catch { throw "进程启动后无法核验身份。请查看日志：$stderr" }
  $record = [ordered]@{
    version = 1; processId = $child.Id; created = $created; instanceId = $instanceId
    executable = $node; entry = $EntryPath; url = $config.Url; address = $config.Address; port = $config.Port
    stdout = $stdout; stderr = $stderr
  }
  try {
    $json = $record | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($StateFile, $json, (New-Object System.Text.UTF8Encoding($false)))
  } catch {
    try { [NightLibrary.ProcessHandle]::StopIfSame($child.Id, $created) } catch { }
    throw '无法保存管理记录，已尝试停止刚启动的进程。请检查 .data 目录的写入权限。'
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    $child.Refresh()
    if ($child.HasExited) {
      # Surface the common, actionable failure instead of just the log path.
      $failure = ''
      try { $failure = [System.IO.File]::ReadAllText($stderr, [System.Text.Encoding]::UTF8) } catch { }
      if ($failure -match 'EADDRNOTAVAIL') {
        throw "监听地址 $($config.Address) 当前不在本机网卡上（IP 可能已变化）。请修改 .env 的 NITRO_HOST 为现在的局域网 IPv4，再重试。"
      }
      throw "网站未能启动。请查看错误日志：$stderr"
    }
    if (Test-Ready $config.Url) {
      try { $owner = Get-ConnectedOwner $config.Address $config.Port } catch { throw "网站已有响应，但无法核验端口归属。请查看状态与日志：$stderr" }
      if ($owner -ne $child.Id) { throw '端口响应来自其他进程，未将它当作本次启动的影视库。' }
      Write-Host "启动成功：$($config.Url)"
      if ($config.Address -ne '127.0.0.1') { Write-Host '局域网访问还需检查 Windows 防火墙，脚本不会自动修改防火墙。' }
      Open-Site $config.Url
      return
    }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "网站在等待时间内没有就绪。请查看状态与日志：$stderr"
}

function Stop-Site {
  $resolved = Resolve-ManagedProcess (Read-ManagerState)
  if ($resolved.Kind -eq 'stopped') { Write-Host '脚本管理的网站未在运行。'; return }
  if ($resolved.Kind -eq 'mismatch') { throw '管理记录与当前进程不匹配，未停止任何程序。请先检查旧实例。' }
  Write-Host '正在停止：当前播放和未完成的上传会中断。'
  try { [NightLibrary.ProcessHandle]::StopIfSame([int]$resolved.Record.processId, [string]$resolved.Record.created) } catch { throw '无法安全停止影视库进程，请检查账户权限和管理记录。' }
  Write-Host '已停止影视库。'
}

function Invoke-Operation([string]$Operation) {
  Invoke-WithLock {
    switch ($Operation) {
      'start' { Start-Site }
      'stop' { Stop-Site }
      'restart' { Stop-Site; Start-Site }
      'status' { Show-Status }
    }
  }
}

Push-Location -LiteralPath $ProjectRoot
try {
  if ($Action -ne 'menu') {
    Invoke-Operation $Action
  } else {
    do {
      Write-Host ''
      Write-Host '========== 夜灯影视库 =========='
      Write-Host '监听地址按配置启动；默认仅本机可访问。'
      Write-Host '  1  启动并打开网站'
      Write-Host '  2  停止网站'
      Write-Host '  3  重启并打开网站'
      Write-Host '  4  查看运行状态'
      Write-Host '  0  退出管理窗口'
      Write-Host '按一个数字键选择：' -NoNewline
      $choice = [Console]::ReadKey($true).KeyChar
      Write-Host $choice
      $operation = switch ($choice) { '1' { 'start' } '2' { 'stop' } '3' { 'restart' } '4' { 'status' } default { '' } }
      if ($operation) {
        try { Invoke-Operation $operation } catch { Write-Host ("操作失败：" + $_.Exception.Message) -ForegroundColor Red }
        Write-Host ''
        Write-Host '按任意键返回菜单…' -NoNewline
        [void][Console]::ReadKey($true)
        Write-Host ''
      }
    } while ($choice -ne '0')
  }
} catch {
  [Console]::Error.WriteLine('操作失败：' + $_.Exception.Message)
  exit 1
} finally {
  Pop-Location
}
