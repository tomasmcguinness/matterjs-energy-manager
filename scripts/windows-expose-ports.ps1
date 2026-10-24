<#
.SYNOPSIS
    Makes the Matter Energy Manager running inside WSL2 reachable from other
    devices on the LAN (phones, the MCC app, other servers).

.DESCRIPTION
    WSL2 runs behind NAT, so the frontend and backend bind an address that only
    exists inside the WSL VM. This forwards the two ports from the Windows host
    to the WSL VM and opens the firewall for them.

    The WSL IP changes when WSL restarts, so re-run this after a reboot.

    Run from an ELEVATED PowerShell (Run as Administrator):
        powershell -ExecutionPolicy Bypass -File .\scripts\windows-expose-ports.ps1

    To undo:
        .\scripts\windows-expose-ports.ps1 -Remove

.NOTES
    This only forwards TCP. Matter device discovery uses mDNS over UDP, which
    NAT still blocks - for that, use mirrored networking mode instead (see the
    README).
#>
[CmdletBinding()]
param(
    [int[]] $Ports = @(4000, 4001),
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'
$FirewallRuleName = 'Matter Energy Manager (WSL2)'

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Error 'This script must be run from an elevated PowerShell (Run as Administrator).'
    exit 1
}

if ($Remove) {
    foreach ($port in $Ports) {
        Write-Host "Removing forward for port $port..."
        netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 | Out-Null
    }

    if (Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue) {
        Remove-NetFirewallRule -DisplayName $FirewallRuleName
        Write-Host "Removed firewall rule '$FirewallRuleName'."
    }

    Write-Host 'Done.'
    exit 0
}

# Ask WSL for its current address; it changes on every WSL restart.
$wslIp = (wsl.exe hostname -I) -split '\s+' | Where-Object { $_ -match '^\d+\.' } | Select-Object -First 1

if (-not $wslIp) {
    Write-Error 'Could not determine the WSL IP address. Is WSL running?'
    exit 1
}

Write-Host "WSL VM address: $wslIp"

foreach ($port in $Ports) {
    # delete first so re-running after a reboot replaces the stale address
    netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 2>$null | Out-Null
    netsh interface portproxy add v4tov4 `
        listenport=$port listenaddress=0.0.0.0 `
        connectport=$port connectaddress=$wslIp | Out-Null
    Write-Host "Forwarding 0.0.0.0:$port -> ${wslIp}:$port"
}

if (-not (Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $FirewallRuleName `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Ports | Out-Null
    Write-Host "Added firewall rule '$FirewallRuleName' for ports $($Ports -join ', ')."
} else {
    Write-Host "Firewall rule '$FirewallRuleName' already present."
}

$hostIps = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'WSL|vEthernet' } |
    Select-Object -ExpandProperty IPAddress

Write-Host ''
Write-Host 'Reachable from other devices at:'
foreach ($ip in $hostIps) {
    Write-Host "  Frontend  http://${ip}:4001"
    Write-Host "  Backend   http://${ip}:4000"
}
