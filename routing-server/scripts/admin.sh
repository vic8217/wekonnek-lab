#!/bin/bash
###############################################################################
#  Admin Utility Script — WeKonnek Routing Server v2.0
#  Usage: ./scripts/admin.sh [command]
#
#  Commands:
#    status       — Show service status
#    restart      — Restart all services
#    rebuild      — Rebuild OSRM map data
#    rebuild-val  — Rebuild Valhalla tiles
#    logs         — View service logs
#    backup       — Backup database
#    update       — Update containers
#    ssl-renew    — Renew SSL certificates
###############################################################################

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

COMMAND="${1:-help}"

case "$COMMAND" in
    status)
        echo "=== Service Status ==="
        docker compose ps
        echo ""
        echo "=== Health Check ==="
        curl -s http://localhost:3100/health | python3 -m json.tool 2>/dev/null || echo "POI API not responding"
        echo ""
        echo "=== OSRM Check ==="
        curl -s "http://localhost:5000/route/v1/driving/121.0,14.5;121.1,14.6" | head -c 200
        echo ""
        echo ""
        echo "=== Valhalla Check ==="
        curl -s "http://localhost:8002/status" | python3 -m json.tool 2>/dev/null || echo "Valhalla not responding"
        echo ""
        echo "=== Photon Check ==="
        curl -s "http://localhost:2322/api?q=Manila&limit=1" | head -c 200
        echo ""
        echo ""
        echo "=== Disk Usage ==="
        du -sh data/osrm/ 2>/dev/null || echo "No OSRM data"
        du -sh data/valhalla/ 2>/dev/null || echo "No Valhalla data"
        docker system df
        ;;

    restart)
        SERVICE="${2:-}"
        if [ -n "$SERVICE" ]; then
            echo "Restarting $SERVICE..."
            docker compose restart "$SERVICE"
        else
            echo "Restarting all services..."
            docker compose restart
        fi
        echo "Services restarted"
        docker compose ps
        ;;

    rebuild)
        echo "Rebuilding OSRM map data..."
        echo "This will download the latest PH OSM data and rebuild the routing graph."
        echo "Driving routes will be temporarily unavailable."
        echo ""
        docker compose stop osrm-backend
        rm -f data/osrm/philippines-latest.osrm*
        bash scripts/build-osrm.sh car
        docker compose up -d osrm-backend
        echo "OSRM rebuilt and restarted"
        ;;

    rebuild-val)
        echo "Rebuilding Valhalla tiles..."
        echo "This forces Valhalla to re-download PH data and rebuild tiles."
        echo "Walking/cycling/isochrone will be temporarily unavailable."
        echo ""
        docker compose stop valhalla
        rm -rf data/valhalla/valhalla_tiles 2>/dev/null || true
        docker compose up -d valhalla
        echo "Valhalla rebuild started. Monitor with:"
        echo "  docker compose logs -f valhalla"
        ;;

    logs)
        SERVICE="${2:-}"
        if [ -n "$SERVICE" ]; then
            docker compose logs -f --tail=100 "$SERVICE"
        else
            docker compose logs -f --tail=50
        fi
        ;;

    backup)
        BACKUP_DIR="$ROOT_DIR/backups"
        mkdir -p "$BACKUP_DIR"
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        BACKUP_FILE="$BACKUP_DIR/wekonnek_poi_$TIMESTAMP.sql.gz"
        echo "Backing up database..."
        docker compose exec -T postgres pg_dump -U wekonnek wekonnek_poi | gzip > "$BACKUP_FILE"
        echo "Backup saved to $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
        ls -tp "$BACKUP_DIR"/wekonnek_poi_*.sql.gz | tail -n +8 | xargs -I {} rm -- {} 2>/dev/null || true
        ;;

    update)
        echo "Pulling latest images..."
        docker compose pull
        echo "Rebuilding POI API..."
        docker compose build poi-api
        echo "Restarting with new images..."
        docker compose up -d
        echo "Cleaning old images..."
        docker image prune -f
        echo "Update complete"
        ;;

    ssl-renew)
        echo "Renewing SSL certificate..."
        sudo certbot renew --quiet
        DOMAIN=$(grep DOMAIN .env | cut -d= -f2)
        if [ -n "$DOMAIN" ]; then
            sudo cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" nginx/ssl/fullchain.pem
            sudo cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" nginx/ssl/privkey.pem
            docker compose restart nginx
            echo "SSL renewed and Nginx restarted"
        else
            echo "DOMAIN not set in .env"
        fi
        ;;

    help|*)
        echo "═══════════════════════════════════════════════"
        echo "  WeKonnek Routing Server v2.0 — Admin Utility"
        echo "═══════════════════════════════════════════════"
        echo ""
        echo "  Usage: ./scripts/admin.sh [command] [service]"
        echo ""
        echo "  Commands:"
        echo "    status         Show all service status & health"
        echo "    restart [svc]  Restart all or specific service"
        echo "    rebuild        Rebuild OSRM driving data"
        echo "    rebuild-val    Rebuild Valhalla tiles"
        echo "    logs [svc]     View logs (optionally for specific service)"
        echo "    backup         Backup POI database"
        echo "    update         Update container images"
        echo "    ssl-renew      Renew SSL certificates"
        echo "    help           Show this help"
        echo ""
        echo "  Services:"
        echo "    osrm-backend   Driving routes, matrix, match, trip"
        echo "    valhalla       Walking/cycling/motorcycle, isochrone, elevation"
        echo "    photon         Forward geocoding, autocomplete"
        echo "    poi-api        API gateway (Express)"
        echo "    postgres       PostGIS database"
        echo "    nginx          Reverse proxy / gateway"
        echo "═══════════════════════════════════════════════"
        ;;
esac
