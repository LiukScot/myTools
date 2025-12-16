FROM php:8.2-cli

# Install SQLite support (pdo_sqlite) and Redis session support
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends sqlite3 libsqlite3-dev; \
    pecl install redis; \
    docker-php-ext-enable redis; \
    docker-php-ext-install pdo_sqlite; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy source into the image
COPY . /app

# Ensure runtime dirs exist for the SQLite DB and PHP session files
RUN mkdir -p /app/data /app/myHealth/sessions /app/myMoney/sessions

# Defaults can be overridden at runtime
ENV HOST=0.0.0.0 \
    PORT=8000

EXPOSE 8000

# Start the unified PHP dev server
CMD ["./run.sh"]
