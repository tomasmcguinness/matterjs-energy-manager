# Matter Energy Manager

I'm trying to create a Matter Device Energy Manager to learn more about Matter's energy management protocol. This project will serve as the DEM part of the energy management. 

You will need a Matter device that supports the device energy management cluster. I have been building one using the esp-matter framework. You can find that project https://github.com/tomasmcguinness/matter-esp32-tiny-dishwasher

This project uses matterjs and uses nextJs for the frontend and nodeJs for the backend.

## Running
The quickest way is the helper script, which starts both servers and stops them
both on Ctrl+C:

```
./start.sh
```

The backend listens on http://localhost:4000 and the frontend on
http://localhost:4001. Override with `PORT` and `FRONTEND_PORT` if those are
taken.

You can also start them by hand in two terminals.

### Accessing it from another machine

Both servers already bind all interfaces, and the UI calls the backend on
whatever host the page was served from, so opening
`http://<this-machine-ip>:4001` from another machine works as-is. The script
prints that address on startup as `Network`.

Two settings are available if the defaults do not suit:

- `NEXT_PUBLIC_API_URL` (frontend) - point the UI at a backend on a different
  host or behind a reverse proxy, e.g. `https://energy.example.com`.
- `CORS_ORIGIN` (backend) - restrict socket.io to specific origins instead of
  reflecting the caller's. Comma-separated.

### Running under WSL2

WSL2 runs behind NAT. The address the servers bind exists only inside the WSL
VM, so phones, the MCC app and other machines on the LAN cannot reach it no
matter how the servers are bound. The fix is on the Windows host.

**Mirrored networking (recommended).** WSL shares the host's network
interfaces, so the servers appear directly on the LAN. This is the option to
pick for Matter work, because it also carries the mDNS/UDP traffic that device
discovery depends on. Needs Windows 11 22H2 or newer.

Create `%UserProfile%\.wslconfig`:

```
[wsl2]
networkingMode=mirrored
```

Then from PowerShell: `wsl --shutdown`, and start WSL again. You may still need
to allow the ports through Windows Firewall.

**Port forwarding (fallback).** Forwards TCP only - enough for the web UI and
the REST/socket.io API, but it will not help Matter device discovery. From an
**elevated** PowerShell:

```
powershell -ExecutionPolicy Bypass -File .\scripts\windows-expose-ports.ps1
```

The WSL IP changes whenever WSL restarts, so re-run it after a reboot. Undo
with `-Remove`.

For the backend
```
cd Backend
node app.js
```

For the frontend

```
cd Frontend
npm run dev
```

This code is rough around the edges, but should work!

I haven't tried it with bluetooth, so you will need to ensure your devices are on-network when commissioning.
