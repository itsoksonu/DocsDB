# Build arg to switch modes (default: prod)
ARG BUILD_ENV=prod

FROM node:20-bookworm-slim

# 🔹 Puppeteer environment (XLSX / CSV thumbnails)
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install ClamAV, gosu, and dependencies (combined for fewer layers)
RUN apt-get update && apt-get install -y \
    clamav \
    clamav-daemon \
    netcat-openbsd \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    gosu \
    libreoffice \            
    poppler-utils \         
    chromium \             
    fonts-dejavu \
    fonts-liberation \
    fonts-noto \
    fonts-noto-cjk \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Create directories for ClamAV socket, logs, and DB + fix permissions
RUN mkdir -p /var/run/clamav /var/log/clamav /var/lib/clamav && \
    chown -R clamav:clamav /var/run/clamav /var/log/clamav /var/lib/clamav && \
    chmod 750 /var/run/clamav && \
    chmod 755 /var/log/clamav

# Remove systemd socket/service units to disable activation (Bookworm fix)
RUN rm -f /lib/systemd/system/clamav-daemon.socket /lib/systemd/system/clamav-daemon.service || true

# Create a custom ClamAV configuration that explicitly sets TCP mode
RUN echo "# Custom ClamAV configuration for TCP mode" > /etc/clamav/clamd.conf && \
    echo "LocalSocket /var/run/clamav/clamd.ctl" >> /etc/clamav/clamd.conf && \
    echo "FixStaleSocket true" >> /etc/clamav/clamd.conf && \
    echo "LocalSocketGroup clamav" >> /etc/clamav/clamd.conf && \
    echo "LocalSocketMode 666" >> /etc/clamav/clamd.conf && \
    echo "" >> /etc/clamav/clamd.conf && \
    echo "# TCP Socket (primary mode)" >> /etc/clamav/clamd.conf && \
    echo "TCPSocket 3310" >> /etc/clamav/clamd.conf && \
    echo "TCPAddr 127.0.0.1" >> /etc/clamav/clamd.conf && \
    echo "" >> /etc/clamav/clamd.conf && \
    echo "# Logging" >> /etc/clamav/clamd.conf && \
    echo "LogFile /var/log/clamav/clamd.log" >> /etc/clamav/clamd.conf && \
    echo "LogTime true" >> /etc/clamav/clamd.conf && \
    if [ "$BUILD_ENV" = "dev" ]; then echo "LogVerbose true" >> /etc/clamav/clamd.conf ; else echo "LogVerbose false" >> /etc/clamav/clamd.conf ; fi && \
    echo "LogFileUnlock false" >> /etc/clamav/clamd.conf && \
    echo "LogFileMaxSize 0" >> /etc/clamav/clamd.conf && \
    echo "" >> /etc/clamav/clamd.conf && \
    echo "# Database" >> /etc/clamav/clamd.conf && \
    echo "DatabaseDirectory /var/lib/clamav" >> /etc/clamav/clamd.conf && \
    echo "OfficialDatabaseOnly false" >> /etc/clamav/clamd.conf && \
    echo "" >> /etc/clamav/clamd.conf && \
    echo "# Timeouts and limits" >> /etc/clamav/clamd.conf && \
    echo "ReadTimeout 300" >> /etc/clamav/clamd.conf && \
    echo "MaxThreads 12" >> /etc/clamav/clamd.conf && \
    echo "MaxConnectionQueueLength 15" >> /etc/clamav/clamd.conf && \
    echo "StreamMaxLength 100M" >> /etc/clamav/clamd.conf && \
    echo "" >> /etc/clamav/clamd.conf && \
    echo "# Daemon settings" >> /etc/clamav/clamd.conf && \
    echo "Foreground false" >> /etc/clamav/clamd.conf && \
    echo "PidFile /var/run/clamav/clamd.pid" >> /etc/clamav/clamd.conf && \
    echo "TemporaryDirectory /tmp" >> /etc/clamav/clamd.conf && \
    echo "User clamav" >> /etc/clamav/clamd.conf && \
    echo "" >> /etc/clamav/clamd.conf && \
    echo "# Detection options" >> /etc/clamav/clamd.conf && \
    echo "DetectPUA true" >> /etc/clamav/clamd.conf && \
    echo "ExcludePUA NetTool" >> /etc/clamav/clamd.conf && \
    echo "ExcludePUA PWTool" >> /etc/clamav/clamd.conf && \
    echo "AlgorithmicDetection true" >> /etc/clamav/clamd.conf

# Verify the configuration was created
RUN echo "=== VERIFYING CLAMAV CONFIG ===" && \
    cat /etc/clamav/clamd.conf | grep -E '^(TCPSocket|TCPAddr|LocalSocket|LogFile|LogVerbose)' && \
    echo "=== CONFIG VERIFICATION COMPLETE ==="

# Update virus definitions (only in prod; dev can skip for speed)
RUN if [ "$BUILD_ENV" = "prod" ]; then freshclam; else echo "Skipping freshclam in dev mode"; fi

# Set working directory
WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies (ci for prod reproducibility, install for dev)
RUN if [ "$BUILD_ENV" = "prod" ]; then \
        npm ci --only=production && npm cache clean --force; \
    else \
        npm install; \
    fi

# Prod-only: Copy source code (dev: mount at runtime)
RUN if [ "$BUILD_ENV" = "prod" ]; then \
        COPY . ./ ; \
    else \
        echo "Skipping source copy in dev mode (mount at runtime)"; \
    fi

# Expose ports
EXPOSE 3001 3310

# Create start script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Start the application (as root for ClamAV, gosu to node for app)
CMD ["/start.sh"]