#!/bin/bash
set -e

BUILD_ENV=${BUILD_ENV:-prod}

echo "🚀 Starting DocsDB Backend with ClamAV (mode: $BUILD_ENV)..."

# Update virus definitions (always in prod; in dev, only if DB missing for speed)
if [ "$BUILD_ENV" = "prod" ]; then
    echo "📦 Updating ClamAV virus definitions..."
    freshclam || echo "⚠️  FreshClam update failed, using existing definitions"
elif [ ! -f /var/lib/clamav/daily.cvd ]; then
    echo "📦 Downloading ClamAV virus definitions (first dev run)..."
    freshclam || echo "⚠️  FreshClam download failed, continuing without full DB"
else
    echo "⏭️ Skipping freshclam in dev mode (DB already present)"
fi

# Print config snippet for debug (TCPSocket and LogFile)
echo "🔍 ClamAV config check (key lines):"
grep -E '^(TCPSocket|TCPAddr|LocalSocket|LogFile|LogVerbose)' /etc/clamav/clamd.conf || echo "⚠️  Config grep failed - check build logs"

# Validate ClamAV config before starting
echo "🔍 Validating ClamAV config..."
if clamd --config-file=/etc/clamav/clamd.conf --help >/dev/null 2>&1; then
    echo "✅ Config validation passed"
else
    echo "❌ Config validation failed - see clamd --help output"
    clamd --config-file=/etc/clamav/clamd.conf --help | head -n 20
    exit 1
fi

# Start ClamAV daemon (daemonizes by default, no --daemon flag needed)
echo "🛡️  Starting ClamAV daemon (TCP mode via config)..."
clamd --config-file=/etc/clamav/clamd.conf &

# Give more time for process to daemonize, load DB, and bind (DB load can take 10-20s, longer on first download)
sleep 10  # Increased from 5s for safety

# Check if clamd process is actually running
CLAMD_PID=$(pgrep clamd || true)
if [ -z "$CLAMD_PID" ]; then
    echo "❌ clamd process failed to start (no PID found)"
    echo "   Checking initial logs..."
    tail -n 10 /var/log/clamav/clamd.log 2>/dev/null || echo "No clamd.log yet"
    exit 1
else
    echo "✅ clamd process started (PID: $CLAMD_PID)"
fi

# Wait for ClamAV to be ready
echo "⏳ Waiting for ClamAV daemon to start..."
CLAMD_READY=0
MAX_WAIT=120  # Increased to 120s for first-run DB download/load
WAITED=0

while [ $CLAMD_READY -eq 0 ] && [ $WAITED -lt $MAX_WAIT ]; do
    if nc -z localhost 3310 2>/dev/null; then
        echo "✅ ClamAV daemon is ready on port 3310"
        CLAMD_READY=1
    else
        echo "   Waiting for ClamAV... ($WAITED/$MAX_WAIT seconds)"
        sleep 1
        WAITED=$((WAITED + 1))
    fi
done

if [ $CLAMD_READY -eq 0 ]; then
    echo "❌ ERROR: ClamAV daemon failed to bind within $MAX_WAIT seconds (PID $CLAMD_PID still running?)"
    echo "   Checking ClamAV logs (clamd.log)..."
    if [ -f "/var/log/clamav/clamd.log" ]; then
        ls -la /var/log/clamav/
        tail -n 20 /var/log/clamav/clamd.log
    else
        echo "   Log file /var/log/clamav/clamd.log does not exist"
    fi
    echo "   System dmesg for OOM/memory issues..."
    dmesg | grep -i 'out of memory\|killed' | tail -n 5 || echo "No OOM in dmesg"
    echo "⚠️  Continuing without ClamAV (basic file validation only)"
else
    echo "✅ ClamAV daemon fully ready"
fi

# Test ClamAV connection (only if ready)
if [ $CLAMD_READY -eq 1 ]; then
    echo "🧪 Testing ClamAV connection..."
    if echo "PING" | nc localhost 3310 2>/dev/null | grep -q "PONG"; then
        echo "✅ ClamAV connection test successful"
    else
        echo "⚠️  ClamAV connection test failed, but continuing anyway"
    fi
fi

# Start Node.js application as node user (nodemon in dev for hot-reload)
if [ "$BUILD_ENV" = "dev" ]; then
    echo "🔄 Starting with nodemon for hot-reloading..."
    exec gosu node ./node_modules/.bin/nodemon --delay 100ms --ignore node_modules --exec "npm start"
else
    echo "🚀 Starting Node.js application..."
    exec gosu node npm start
fi