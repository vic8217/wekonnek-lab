#!/bin/bash
###############################################################################
#  Photon Geocoder — Data Import Script
#  Downloads pre-built Photon index for the Philippines
#  
#  Usage: ./scripts/import-photon.sh
#  
#  Photon needs a search index built from Nominatim data.
#  Options:
#    A) Download pre-built extract from photon.komoot.io (fastest)
#    B) Run Nominatim import + Photon indexing (most up-to-date, slower)
###############################################################################

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PHOTON_DIR="$ROOT_DIR/data/photon"

echo "═══════════════════════════════════════════════"
echo "  Photon Geocoder — Data Import"
echo "═══════════════════════════════════════════════"
echo ""

mkdir -p "$PHOTON_DIR"

# ─── Option A: Download pre-built extract ────────
echo "Downloading Photon search index..."
echo "This is a global extract (~8GB compressed)."
echo "After download, Photon will filter to PH queries via country-codes flag."
echo ""

PHOTON_URL="https://download1.graphhopper.com/public/photon-db-latest.tar.bz2"

if [ -d "$PHOTON_DIR/photon_data/elasticsearch" ] || [ -d "$PHOTON_DIR/photon_data/photon.mv.db" ]; then
    echo "Photon data already exists. Skipping download."
    echo "Delete data/photon/photon_data to force re-download."
else
    echo "Downloading from: $PHOTON_URL"
    echo "This may take 30-60 minutes depending on bandwidth..."
    echo ""

    cd "$PHOTON_DIR"
    wget -c "$PHOTON_URL" -O photon-db-latest.tar.bz2

    echo ""
    echo "Extracting..."
    tar -xjf photon-db-latest.tar.bz2
    rm -f photon-db-latest.tar.bz2

    echo "Photon data extracted."
fi

echo ""

# ─── Copy data to Docker volume ─────────────────
echo "Ensuring Docker volume has the data..."
echo "If Photon is already running, restart it:"
echo "  docker compose restart photon"
echo ""

echo "═══════════════════════════════════════════════"
echo "  Photon data import complete!"
echo ""
echo "  Start Photon:"
echo "    docker compose up -d photon"
echo ""
echo "  Test:"
echo "    curl 'http://localhost:2322/api?q=Manila&limit=3'"
echo ""
echo "  Note: Photon is configured with -country-codes ph"
echo "  to restrict results to the Philippines."
echo "═══════════════════════════════════════════════"
