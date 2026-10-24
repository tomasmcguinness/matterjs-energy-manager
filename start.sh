#!/usr/bin/env bash
#
# Starts both the backend (Matter/Express/socket.io) and the frontend (Next.js).
# Ctrl+C stops both.
#
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/Backend"
FRONTEND_DIR="$ROOT_DIR/Frontend"

BACKEND_PORT="${PORT:-4000}"
FRONTEND_PORT="${FRONTEND_PORT:-4001}"

# Seconds to wait for a graceful stop before SIGKILL.
SHUTDOWN_GRACE="${SHUTDOWN_GRACE:-5}"

pids=()
shutting_down=0

# Signal a server's whole process group, so its children (next, etc.) go too.
signal_group() {
    local sig="$1" pid="$2"
    kill -"$sig" -"$pid" 2>/dev/null || kill -"$sig" "$pid" 2>/dev/null
}

cleanup() {
    trap - INT TERM EXIT
    shutting_down=1

    # Nothing was started yet (e.g. a failed pre-flight check) - nothing to stop.
    if [ "${#pids[@]}" -eq 0 ]; then
        return
    fi

    echo ""
    echo "Shutting down..."

    for pid in "${pids[@]:-}"; do
        [ -n "$pid" ] && signal_group TERM "$pid"
    done

    # The backend does not always exit on SIGTERM, and a survivor keeps port
    # $BACKEND_PORT bound, which breaks the next run. Give it a grace period,
    # then force it.
    local waited=0
    while [ "$waited" -lt "$SHUTDOWN_GRACE" ]; do
        local alive=0
        for pid in "${pids[@]:-}"; do
            [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && alive=1
        done
        [ "$alive" -eq 0 ] && break
        sleep 1
        waited=$((waited + 1))
    done

    for pid in "${pids[@]:-}"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            echo "Process group $pid did not stop in ${SHUTDOWN_GRACE}s; forcing."
            signal_group KILL "$pid"
        fi
    done

    wait 2>/dev/null
    echo "Stopped."
}
trap cleanup INT TERM EXIT

# Prefix each line of a child's output so the two servers are told apart.
prefix() {
    local label="$1"
    while IFS= read -r line; do
        printf '[%s] %s\n' "$label" "$line"
    done
}

install_if_needed() {
    local dir="$1" label="$2"
    if [ ! -d "$dir/node_modules" ]; then
        echo "[$label] node_modules missing, running npm install..."
        (cd "$dir" && npm install) || {
            echo "[$label] npm install failed." >&2
            exit 1
        }
    fi
}

# A stale server still holding a port makes the new one fail with a confusing
# EADDRINUSE deep in its own output; say so plainly instead.
check_port_free() {
    local port="$1" label="$2"
    local holder=""
    if command -v ss >/dev/null 2>&1; then
        holder="$(ss -ltnp "sport = :$port" 2>/dev/null | tail -n +2)"
    elif command -v lsof >/dev/null 2>&1; then
        holder="$(lsof -iTCP:"$port" -sTCP:LISTEN -P -n 2>/dev/null | tail -n +2)"
    fi
    if [ -n "$holder" ]; then
        echo "Port $port ($label) is already in use:" >&2
        echo "  $holder" >&2
        echo "Stop that process, or set a different port, then try again." >&2
        exit 1
    fi
}

command -v node >/dev/null 2>&1 || { echo "node is not installed or not on PATH." >&2; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "npm is not installed or not on PATH." >&2; exit 1; }

check_port_free "$BACKEND_PORT" backend
check_port_free "$FRONTEND_PORT" frontend

install_if_needed "$BACKEND_DIR" backend
install_if_needed "$FRONTEND_DIR" frontend

# Both servers bind all interfaces, so show the LAN address too - that is the
# one another machine needs.
# Ask the routing table which source address outbound traffic uses; picking the
# first "global" address instead can return a /32 bound to loopback.
LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1)"

echo "Backend   http://localhost:$BACKEND_PORT"
echo "Frontend  http://localhost:$FRONTEND_PORT"
if [ -n "$LAN_IP" ]; then
    echo "Network   http://$LAN_IP:$FRONTEND_PORT  (frontend), http://$LAN_IP:$BACKEND_PORT (backend)"
fi
echo "Press Ctrl+C to stop both."
echo ""

# setsid gives each server its own process group, so cleanup can kill its children too.
# Process substitution (not a pipe) so $! is the setsid PID, i.e. the group leader.
setsid bash -c "cd '$BACKEND_DIR' && PORT='$BACKEND_PORT' exec node app.js" \
    > >(prefix backend) 2>&1 &
pids+=($!)

setsid bash -c "cd '$FRONTEND_DIR' && exec npx next dev -p '$FRONTEND_PORT'" \
    > >(prefix frontend) 2>&1 &
pids+=($!)

# Exit as soon as either server dies, so a crashed backend doesn't go unnoticed.
wait -n
if [ "$shutting_down" -eq 0 ]; then
    echo ""
    echo "One of the servers exited; stopping the other."
fi
