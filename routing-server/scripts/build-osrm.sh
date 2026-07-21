#!/bin/bash
###############################################################################
#  OSRM PH Map Build Script
#  Downloads Philippines OSM extract and builds routing graph
#  Usage: ./scripts/build-osrm.sh [car|motorcycle]
###############################################################################

set -euo pipefail

PROFILE="${1:-car}"
DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/data/osrm"
OSM_URL="https://download.geofabrik.de/asia/philippines-latest.osm.pbf"
OSM_FILE="$DATA_DIR/philippines-latest.osm.pbf"
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:latest"

echo "═══════════════════════════════════════════════"
echo "  WeKonnek OSRM Build — Philippines ($PROFILE)"
echo "═══════════════════════════════════════════════"
echo ""

# Create data directory
mkdir -p "$DATA_DIR"

# ─── Step 1: Download PH OSM extract ──────────
echo "📥 Step 1/4: Downloading Philippines OSM extract..."
if [ -f "$OSM_FILE" ]; then
    echo "   File exists. Checking age..."
    FILE_AGE=$(($(date +%s) - $(stat -c %Y "$OSM_FILE" 2>/dev/null || stat -f %m "$OSM_FILE")))
    if [ $FILE_AGE -gt 604800 ]; then
        echo "   File is older than 7 days. Re-downloading..."
        wget -O "$OSM_FILE" "$OSM_URL"
    else
        echo "   File is recent. Skipping download."
    fi
else
    wget -O "$OSM_FILE" "$OSM_URL"
fi
echo "   ✅ OSM extract ready ($(du -h "$OSM_FILE" | cut -f1))"
echo ""

# ─── Step 2: Extract ──────────────────────────
echo "🔧 Step 2/4: Extracting road network..."
docker run --rm -t \
    -v "$DATA_DIR:/data" \
    "$OSRM_IMAGE" \
    osrm-extract \
    -p /opt/${PROFILE}.lua \
    /data/philippines-latest.osm.pbf

echo "   ✅ Extraction complete"
echo ""

# ─── Step 3: Partition ─────────────────────────
echo "🔧 Step 3/4: Partitioning graph (MLD algorithm)..."
docker run --rm -t \
    -v "$DATA_DIR:/data" \
    "$OSRM_IMAGE" \
    osrm-partition \
    /data/philippines-latest.osrm

echo "   ✅ Partition complete"
echo ""

# ─── Step 4: Customize ────────────────────────
echo "🔧 Step 4/4: Customizing graph..."
docker run --rm -t \
    -v "$DATA_DIR:/data" \
    "$OSRM_IMAGE" \
    osrm-customize \
    /data/philippines-latest.osrm

echo "   ✅ Customization complete"
echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ OSRM build complete!"
echo "  Profile: $PROFILE"
echo "  Data dir: $DATA_DIR"
echo ""
echo "  Start with: docker compose up -d osrm-backend"
echo "  Test: curl http://localhost:5000/route/v1/driving/121.0,14.5;121.1,14.6"
echo "═══════════════════════════════════════════════"
