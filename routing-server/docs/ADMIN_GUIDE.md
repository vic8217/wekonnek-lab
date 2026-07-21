# WeKonnek Routing Server — Admin Guide

## Quick Reference

| Command | What it does |
|---------|-------------|
| `./scripts/admin.sh status` | Check all services |
| `./scripts/admin.sh restart` | Restart all services |
| `./scripts/admin.sh rebuild` | Re-download PH map & rebuild |
| `./scripts/admin.sh logs [service]` | View live logs |
| `./scripts/admin.sh backup` | Backup POI database |
| `./scripts/admin.sh update` | Update Docker images |
| `./scripts/admin.sh ssl-renew` | Renew SSL certificate |

## Services

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| OSRM | wekonnek-osrm | 5000 | Routing engine |
| POI API | wekonnek-poi-api | 3100 | Nearby + Reverse geocoding |
| PostgreSQL | wekonnek-poi-db | 5432 | POI data storage |
| Nginx | wekonnek-routing-gateway | 80/443 | Gateway + SSL + Auth |

---

## 1. How to Restart Services

```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart osrm-backend
docker compose restart poi-api
docker compose restart postgres
docker compose restart nginx
```

## 2. How to Rebuild Map Data

When OpenStreetMap data gets updated (recommended: monthly):

```bash
# Full rebuild
./scripts/admin.sh rebuild

# Or manually:
docker compose stop osrm-backend
rm -f data/osrm/philippines-latest.osrm*
./scripts/build-osrm.sh car
docker compose up -d osrm-backend
```

**Timeline:** ~2-4 hours depending on server speed.

## 3. How to Renew SSL

### Automatic (recommended)
Add to crontab:
```bash
crontab -e
# Add this line:
0 3 1 * * /path/to/routing-server/scripts/admin.sh ssl-renew
```

### Manual
```bash
./scripts/admin.sh ssl-renew
```

## 4. How to Update POI Data

```bash
# Stop POI service temporarily
docker compose stop poi-api

# Re-import POIs
./scripts/import-poi.sh

# Restart
docker compose up -d poi-api
```

## 5. How to Add/Remove API Keys

Edit `nginx/api_keys.conf`:
```nginx
map $api_key $valid_api_keys {
    default "";
    "your-new-key-here"  "valid";
    # Remove or comment out old keys
}
```

Then reload Nginx:
```bash
docker compose exec nginx nginx -s reload
```

## 6. How to View Logs

```bash
# All services
./scripts/admin.sh logs

# Specific service
./scripts/admin.sh logs osrm-backend
./scripts/admin.sh logs poi-api
./scripts/admin.sh logs nginx

# Nginx access logs
tail -f logs/nginx/access.log

# Nginx error logs
tail -f logs/nginx/error.log
```

## 7. Database Access

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U wekonnek wekonnek_poi

# Count POIs
docker compose exec postgres psql -U wekonnek wekonnek_poi -c "SELECT category, COUNT(*) FROM pois GROUP BY category ORDER BY count DESC;"

# Backup
./scripts/admin.sh backup
```

## 8. Monitoring

### Health Check URL
```
https://route.yourdomain.com/health
```

Use with UptimeRobot, Pingdom, or similar service.

### Server Resources
```bash
# Memory & CPU
htop

# Disk usage
df -h
du -sh data/osrm/

# Docker stats
docker stats --no-stream
```

## 9. Troubleshooting

| Problem | Solution |
|---------|---------|
| OSRM returns 400 | Check coordinates are in PH range (lat: 4.5-21.5, lng: 116-127) |
| Nearby returns empty | POI data may not be imported. Run `./scripts/import-poi.sh` |
| 502 Bad Gateway | Container crashed. Check `docker compose ps` and restart |
| High memory usage | OSRM uses ~8-16GB. Ensure server has enough RAM |
| SSL certificate expired | Run `./scripts/admin.sh ssl-renew` |
| Slow routing queries | Rebuild OSRM data: `./scripts/admin.sh rebuild` |

## 10. Server Requirements Reminder

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 vCPU | 8 vCPU |
| RAM | 16 GB | 32 GB |
| Storage | 200 GB SSD | 300-500 GB NVMe |
| OS | Ubuntu 22.04 | Ubuntu 24.04 LTS |
