#!/bin/bash
###############################################################################
#  SSL Setup — Let's Encrypt via Certbot
#  Usage: ./scripts/ssl-setup.sh route.yourdomain.com admin@yourdomain.com
###############################################################################

set -euo pipefail

DOMAIN="${1:-${DOMAIN:-route.yourdomain.com}}"
EMAIL="${2:-${ADMIN_EMAIL:-admin@yourdomain.com}}"
SSL_DIR="$(cd "$(dirname "$0")/.." && pwd)/nginx/ssl"

echo "═══════════════════════════════════════════════"
echo "  SSL Setup for $DOMAIN"
echo "═══════════════════════════════════════════════"

# Install certbot if needed
command -v certbot >/dev/null 2>&1 || {
    echo "📦 Installing Certbot..."
    sudo apt-get update
    sudo apt-get install -y certbot
}

# Stop nginx temporarily for standalone verification
echo "⏸️  Stopping nginx for certificate verification..."
docker compose stop nginx 2>/dev/null || true

# Get certificate
echo "🔒 Requesting SSL certificate..."
sudo certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN"

# Copy certs to nginx ssl directory
echo "📁 Copying certificates..."
mkdir -p "$SSL_DIR"
sudo cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$SSL_DIR/fullchain.pem"
sudo cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$SSL_DIR/privkey.pem"
sudo chmod 644 "$SSL_DIR/fullchain.pem"
sudo chmod 600 "$SSL_DIR/privkey.pem"

# Restart nginx
echo "▶️  Starting nginx..."
docker compose up -d nginx

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ SSL certificate installed!"
echo "  Domain: https://$DOMAIN"
echo ""
echo "  Auto-renewal cron (add to crontab -e):"
echo '  0 3 * * * certbot renew --quiet --deploy-hook "docker compose -f /path/to/docker-compose.yml restart nginx"'
echo "═══════════════════════════════════════════════"
