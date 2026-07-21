#!/bin/bash
###############################################################################
#  Full Deployment Script — WeKonnek Routing Server v2.0
#  Services: OSRM + Valhalla + Photon + PostGIS + POI API + Nginx
#  
#  Usage:
#    ./scripts/deploy.sh          # Interactive (pauses for .env edit)
#    ./scripts/deploy.sh --auto   # Non-interactive (requires .env to exist)
###############################################################################

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AUTO_MODE="${1:-}"

echo "═══════════════════════════════════════════════"
echo "  WeKonnek Routing Server v2.0 — Full Deployment"
echo "  Services: OSRM, Valhalla, Photon, PostGIS,"
echo "            POI API, Nginx"
echo "═══════════════════════════════════════════════"
echo ""

# ─── Step 1: Check prerequisites ────────────────
echo "╔═══ Step 1/8: Checking prerequisites ═══╗"
if ! command -v docker &> /dev/null; then
    echo "   Docker is not installed!"
    echo "   Run: sudo ./scripts/harden-server.sh"
    echo "   or: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo "   Docker Compose plugin not found!"
    echo "   Run: sudo apt-get install -y docker-compose-plugin"
    exit 1
fi
echo "   Docker $(docker --version | grep -oP '\d+\.\d+\.\d+')"
echo "   Docker Compose $(docker compose version --short)"
echo ""

# ─── Step 2: Server hardening (optional) ────────
echo "╔═══ Step 2/8: Server hardening ═══╗"
if command -v ufw &> /dev/null && ufw status 2>/dev/null | grep -q "active"; then
    echo "   Firewall already configured, skipping..."
else
    echo "   Firewall not active. Run: sudo ./scripts/harden-server.sh"
    echo "   Continuing anyway..."
fi
echo ""

# ─── Step 3: Create directories ─────────────────
echo "╔═══ Step 3/8: Creating directories ═══╗"
mkdir -p "$ROOT_DIR/data/osrm"
mkdir -p "$ROOT_DIR/data/valhalla"
mkdir -p "$ROOT_DIR/logs/nginx"
mkdir -p "$ROOT_DIR/nginx/ssl"
mkdir -p "$ROOT_DIR/backups"
echo "   Directories created"
echo ""

# ─── Step 4: Environment setup ──────────────────
echo "╔═══ Step 4/8: Environment setup ═══╗"
if [ ! -f "$ROOT_DIR/.env" ]; then
    if [ -f "$ROOT_DIR/.env.example" ]; then
        cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
        echo "   Created .env from .env.example"
        echo "   IMPORTANT: Edit .env with your actual values!"
        echo ""
        if [ "$AUTO_MODE" != "--auto" ]; then
            echo "   Open another terminal and edit: $ROOT_DIR/.env"
            echo "   Then press Enter to continue..."
            read -r
        else
            echo "   Running in auto mode — using defaults."
            echo "   Change passwords before going live!"
        fi
    else
        echo "   No .env.example found! Creating minimal .env..."
        cat > "$ROOT_DIR/.env" <<'EOF'
DOMAIN=route.yourdomain.com
ADMIN_EMAIL=admin@yourdomain.com
DB_USER=wekonnek
DB_PASSWORD=wekonnek_secure_2024
EOF
        echo "   Default .env created. Change passwords before production!"
    fi
else
    echo "   .env already exists"
fi
echo ""

# ─── Step 5: Build OSRM data ────────────────────
echo "╔═══ Step 5/8: Building OSRM routing data ═══╗"
if [ -f "$ROOT_DIR/data/osrm/philippines-latest.osrm.cell_metrics" ]; then
    echo "   OSRM data already built, skipping..."
    echo "   (delete data/osrm/*.osrm* to force rebuild)"
else
    echo "   Building OSRM Philippines map data..."
    echo "   This downloads ~500MB and takes 1-3 hours."
    bash "$ROOT_DIR/scripts/build-osrm.sh" car
fi
echo ""

# ─── Step 6: Start services ─────────────────────
echo "╔═══ Step 6/8: Starting services ═══╗"
cd "$ROOT_DIR"
docker compose pull
docker compose build poi-api
docker compose up -d

echo "   Waiting for core services to become healthy..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:3100/health > /dev/null 2>&1; then
        echo "   POI API is healthy"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "   POI API not responding yet (may still be starting)"
    fi
    sleep 2
done

echo ""
echo "   Service status:"
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""

# ─── Step 7: Wait for Valhalla tile build ────────
echo "╔═══ Step 7/8: Valhalla tile build ═══╗"
echo "   Valhalla auto-downloads PH data and builds tiles on first start."
echo "   This takes 30-60 minutes. Services available immediately:"
echo "   - Driving (OSRM): available now"
echo "   - Walking/Cycling/Isochrone (Valhalla): available after tile build"
echo "   - Geocoding (Photon): may need initial data import"
echo ""
echo "   Monitor Valhalla progress:"
echo "   docker compose logs -f valhalla"
echo ""

# ─── Step 8: Import POI data ────────────────────
echo "╔═══ Step 8/8: Importing POI data ═══╗"
echo "   POI import requires osm2pgsql on the host."
echo "   Run manually after deployment:"
echo "   ./scripts/import-poi.sh"
echo ""

# ─── Done ───────────────────────────────────────
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_SERVER_IP")
echo "═══════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE!"
echo ""
echo "  API Endpoints (via gateway on port 80):"
echo ""
echo "  Routing & Navigation:"
echo "    Driving:      /route/v1/driving/{coords}"
echo "    Walking:      /route/v1/walking/{coords}"
echo "    Cycling:      /route/v1/cycling/{coords}"
echo "    Motorcycle:   /route/v1/motorcycle/{coords}"
echo "    Matrix:       /matrix?origins=...&destinations=..."
echo "    Match:        /match?coordinates=..."
echo "    Trip:         /trip?coordinates=..."
echo ""
echo "  Geocoding & Places:"
echo "    Geocode:      /geocode?q=..."
echo "    Autocomplete: /autocomplete?q=..."
echo "    Reverse:      /reverse?lat=...&lng=..."
echo "    Nearby:       /nearby?lat=...&lng=..."
echo "    Place:        /place/{id}"
echo "    Categories:   /categories"
echo ""
echo "  Analysis:"
echo "    Isochrone:    /isochrone?lat=...&lng=...&range=..."
echo "    Elevation:    /elevation?points=..."
echo ""
echo "  System:"
echo "    Health:       /health"
echo "    Docs:         /docs"
echo ""
echo "  Quick test:"
echo "    curl http://${SERVER_IP}/health"
echo "    curl 'http://${SERVER_IP}/route/v1/driving/120.9842,14.5995;121.0244,14.5547?api_key=whp_routing_dev_key_change_me'"
echo ""
echo "  Next steps:"
echo "    1. Import POI data:  ./scripts/import-poi.sh"
echo "    2. Set DNS A record: ${DOMAIN:-route.yourdomain.com} -> ${SERVER_IP}"
echo "    3. Set up SSL:       ./scripts/ssl-setup.sh ${DOMAIN:-route.yourdomain.com}"
echo "    4. Update API keys:  nano nginx/api_keys.conf"
echo "    5. Reload Nginx:     docker compose exec nginx nginx -s reload"
echo "═══════════════════════════════════════════════"
