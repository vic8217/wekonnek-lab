#!/bin/bash
###############################################################################
#  POI Import Script
#  Downloads Philippines OSM data and imports POIs into PostGIS
#  Usage: ./scripts/import-poi.sh
###############################################################################

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$ROOT_DIR/data"
OSM_URL="https://download.geofabrik.de/asia/philippines-latest.osm.pbf"
OSM_FILE="$DATA_DIR/osrm/philippines-latest.osm.pbf"

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-wekonnek_poi}"
DB_USER="${DB_USER:-wekonnek}"
DB_PASSWORD="${DB_PASSWORD:-wekonnek_secure_2024}"

echo "═══════════════════════════════════════════════"
echo "  WeKonnek POI Import — Philippines"
echo "═══════════════════════════════════════════════"
echo ""

# Download if needed
mkdir -p "$DATA_DIR/osrm"
if [ ! -f "$OSM_FILE" ]; then
    echo "📥 Downloading Philippines OSM extract..."
    wget -O "$OSM_FILE" "$OSM_URL"
fi

echo "📥 Importing POI data into PostGIS..."

export PGPASSWORD="$DB_PASSWORD"

# Try osm2pgsql if available (more complete import)
if command -v osm2pgsql &> /dev/null; then
    echo "   Using osm2pgsql for import..."
    osm2pgsql \
        --create \
        --slim \
        -G \
        --hstore \
        --style "$ROOT_DIR/db/poi.style" \
        -d "$DB_NAME" \
        -U "$DB_USER" \
        -H "$DB_HOST" \
        -P "$DB_PORT" \
        "$OSM_FILE" \
        2>&1 && {
        echo "   ✅ osm2pgsql import completed"
        echo ""
        echo "🔍 Extracting POIs from imported data..."
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
            -f "$ROOT_DIR/db/import-pois.sql"
    } || {
        echo "⚠️  osm2pgsql import failed, falling back to SQL-only approach..."
        echo "   Note: SQL-only import requires osm2pgsql to have been run at least once"
        echo "   to create planet_osm_point table."
    }
else
    echo "⚠️  osm2pgsql not found."
    echo "   Installing osm2pgsql..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y osm2pgsql
        echo "   osm2pgsql installed. Re-run this script."
        exit 1
    else
        echo "   ❌ Cannot install osm2pgsql automatically."
        echo "   Install manually: https://osm2pgsql.org/doc/install.html"
        exit 1
    fi
fi

echo ""
echo "🔍 Creating spatial indexes and running post-import..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    -f "$ROOT_DIR/db/post-import.sql"

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ POI import complete!"
echo ""
echo "  Test: curl 'http://localhost:3100/nearby?lat=14.5995&lng=120.9842&radius=1000'"
echo "═══════════════════════════════════════════════"
