# WeKonnek Routing Server v2.0 — Deployment Guide

> **Full Google Maps Platform alternative — self-hosted**  
> Replaces Directions, Distance Matrix, Roads, Geocoding, Places, Isochrone, and Elevation APIs  
> with OSRM + Valhalla + Photon + PostGIS at a fraction of the cost.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         NGINX (Gateway)                             │
│             :80 / :443  •  SSL  •  API Key Auth                     │
│             Rate limiting  •  Response caching                      │
├───────────┬──────────────┬──────────────┬──────────────┬───────────┤
│           │              │              │              │           │
│  Routing  │   Geocoding  │    Places    │   Analysis   │  System   │
│  /route/* │  /geocode    │  /nearby     │  /isochrone  │  /health  │
│  /matrix  │  /autocomplete│ /place/:id  │  /elevation  │  /docs    │
│  /match   │  /reverse    │  /categories │              │           │
│  /trip    │              │              │              │           │
│           │              │              │              │           │
├───────────┴──────────────┴──────────────┴──────────────┴───────────┤
│                        POI API (Express)                            │
│                    Aggregates all backend engines                    │
├──────────┬──────────┬──────────┬────────────────────────────────────┤
│          │          │          │                                     │
│   OSRM   │ Valhalla │  Photon  │  PostgreSQL + PostGIS              │
│  driving │ walk/bike│ geocoder │  POI data, addresses               │
│  matrix  │ isochrone│ search   │  spatial queries                   │
│  match   │ elevation│          │                                     │
│  trip    │ motorcycle│         │                                     │
└──────────┴──────────┴──────────┴────────────────────────────────────┘
```

| Service | Container | Port | Purpose |
|---------|-----------|------|---------|
| OSRM | wekonnek-osrm | 5000 | Driving routes, matrix, matching, trip optimization |
| Valhalla | wekonnek-valhalla | 8002 | Walking/cycling/motorcycle routing, isochrones, elevation |
| Photon | wekonnek-photon | 2322 | Forward geocoding, autocomplete |
| PostgreSQL + PostGIS | wekonnek-poi-db | 5432 | POI data + spatial queries + reverse geocoding |
| POI API (Node.js) | wekonnek-poi-api | 3100 | Express API aggregating all engines |
| Nginx | wekonnek-routing-gateway | 80/443 | Gateway, SSL, auth, rate limiting, caching |
| Watchtower | wekonnek-watchtower | — | Auto-update containers |

---

## Server Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **CPU** | 4 vCPU | 8+ vCPU |
| **RAM** | 24 GB | 32-64 GB |
| **Storage** | 300 GB SSD | 500 GB NVMe |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| **Network** | Public IP | Static IP + domain |

> OSRM uses ~8-12 GB RAM, Valhalla ~4-6 GB, Photon ~2-4 GB, PostGIS ~1-2 GB.  
> 24 GB is the minimum; 32 GB is recommended for comfortable operation.

### Recommended VPS Providers (PH region)
- **DigitalOcean** — SGP1 datacenter (Singapore, nearest to PH)
- **Vultr** — Singapore location
- **AWS Lightsail** — ap-southeast-1
- **Linode/Akamai** — Singapore
- **Hetzner** — Singapore (best price/performance)

---

## Step-by-Step Deployment

### Step 1: Provision Server

Spin up an Ubuntu 22.04/24.04 VPS with at least 24 GB RAM.

```bash
ssh root@YOUR_SERVER_IP
```

### Step 2: Clone the Repository

```bash
cd /opt
git clone https://github.com/YOUR_ORG/wekonnek-1.git
cd wekonnek-1/routing-server
```

### Step 3: Harden the Server

```bash
sudo chmod +x scripts/*.sh
sudo ./scripts/harden-server.sh
```

This installs Docker, configures UFW firewall, fail2ban, SSH key-only access, and auto security updates.

### Step 4: Configure Environment

```bash
cp .env.example .env
nano .env
```

```env
DOMAIN=route.yourdomain.com
ADMIN_EMAIL=admin@yourdomain.com
DB_USER=wekonnek
DB_PASSWORD=a_strong_random_password_here
```

### Step 5: Set API Keys

```bash
nano nginx/api_keys.conf
```

```nginx
map $api_key $valid_api_keys {
    default "";
    "whp_backend_prod_YOUR_SECRET_1"   "valid";
    "whp_customer_app_YOUR_SECRET_2"   "valid";
    "whp_provider_app_YOUR_SECRET_3"   "valid";
    "whp_admin_portal_YOUR_SECRET_4"   "valid";
}
```

Generate secure keys: `openssl rand -hex 24`

### Step 6: Build OSRM Map Data

Downloads Philippines OSM extract (~500 MB) and builds the driving routing graph. Takes **1-3 hours**.

```bash
./scripts/build-osrm.sh car
```

### Step 7: Start All Services

```bash
docker compose pull
docker compose build poi-api
docker compose up -d
```

Verify everything is running:

```bash
docker compose ps
```

Expected output:
```
NAME                       STATUS              PORTS
wekonnek-osrm              running (healthy)   0.0.0.0:5000->5000/tcp
wekonnek-valhalla          running (healthy)   0.0.0.0:8002->8002/tcp
wekonnek-photon            running (healthy)   0.0.0.0:2322->2322/tcp
wekonnek-poi-db            running (healthy)   0.0.0.0:5432->5432/tcp
wekonnek-poi-api           running (healthy)   0.0.0.0:3100->3100/tcp
wekonnek-routing-gateway   running             0.0.0.0:80->80/tcp, 443/tcp
wekonnek-watchtower        running
```

> **Valhalla** auto-downloads PH data and builds tiles on first start (30-60 min).  
> **Photon** may need data import — see Step 9.

### Step 8: Test the Services

```bash
# Health check
curl http://localhost/health

# Driving route
curl -H "X-API-Key: whp_routing_dev_key_change_me" \
  "http://localhost/route/v1/driving/120.9842,14.5995;121.0244,14.5547?steps=true"

# Distance matrix
curl -H "X-API-Key: whp_routing_dev_key_change_me" \
  "http://localhost/matrix?origins=120.9842,14.5995;121.0244,14.5547"

# Forward geocoding
curl -H "X-API-Key: whp_routing_dev_key_change_me" \
  "http://localhost/geocode?q=Jollibee+Manila"

# Autocomplete
curl -H "X-API-Key: whp_routing_dev_key_change_me" \
  "http://localhost/autocomplete?q=jol&lat=14.5995&lng=120.9842"
```

### Step 9: Import Data

```bash
# Import POIs into PostGIS
sudo apt-get install -y osm2pgsql
./scripts/import-poi.sh

# Import Photon geocoding data (optional — large download)
./scripts/import-photon.sh
```

### Step 10: Set Up SSL

Point your domain DNS A record to the server IP, then:

```bash
./scripts/ssl-setup.sh route.yourdomain.com admin@yourdomain.com
```

Edit `nginx/conf.d/default.conf`:
1. Uncomment the HTTPS listener block
2. Uncomment the HTTP → HTTPS redirect block
3. Remove `listen 80` from the main server block

```bash
docker compose exec nginx nginx -s reload
```

### Step 11: Run Integration Tests

```bash
node poi-api/test/test.js http://localhost:3100
```

---

## One-Command Deployment

```bash
./scripts/deploy.sh --auto
```

---

## Connecting Apps

### Backend (NestJS)

```env
ROUTING_SERVER_URL=https://route.yourdomain.com
ROUTING_API_KEY=whp_backend_prod_YOUR_SECRET
```

### Flutter Apps

```dart
static const String routingBaseUrl = 'https://route.yourdomain.com';
static const String routingApiKey  = 'whp_customer_app_YOUR_SECRET';
```

### API Usage Examples

```dart
// Driving directions
final url = '$routingBaseUrl/route/v1/driving/$oLng,$oLat;$dLng,$dLat'
    '?steps=true&api_key=$routingApiKey';

// Walking directions
final url = '$routingBaseUrl/route/v1/walking/$oLng,$oLat;$dLng,$dLat'
    '?steps=true&api_key=$routingApiKey';

// Distance matrix
final url = '$routingBaseUrl/matrix'
    '?origins=$oLng,$oLat;$oLng2,$oLat2&destinations=$dLng,$dLat&api_key=$routingApiKey';

// Trip optimization (delivery route)
final url = '$routingBaseUrl/trip'
    '?coordinates=$stops&roundtrip=false&source=first&destination=last&api_key=$routingApiKey';

// Forward geocoding / search
final url = '$routingBaseUrl/geocode?q=$query&lat=$lat&lng=$lng&api_key=$routingApiKey';

// Autocomplete
final url = '$routingBaseUrl/autocomplete?q=$input&lat=$lat&lng=$lng&api_key=$routingApiKey';

// Place details
final url = '$routingBaseUrl/place/$placeId?api_key=$routingApiKey';

// Isochrone (delivery radius)
final url = '$routingBaseUrl/isochrone'
    '?lat=$lat&lng=$lng&range=600,1200,1800&mode=driving&api_key=$routingApiKey';
```

---

## Maintenance

### Daily Operations

```bash
./scripts/admin.sh status         # All service status & health
./scripts/admin.sh logs           # All logs
./scripts/admin.sh logs valhalla  # Specific service
./scripts/admin.sh restart        # Restart all
./scripts/admin.sh restart photon # Restart specific
```

### Monthly: Update Map Data

```bash
./scripts/admin.sh rebuild        # Rebuild OSRM (driving)
./scripts/admin.sh rebuild-val    # Rebuild Valhalla (walking/cycling/isochrone)
./scripts/import-poi.sh           # Refresh POI data
```

### Backup Database

```bash
./scripts/admin.sh backup
# Saved to ./backups/ (last 7 kept automatically)
```

### Update Containers

```bash
./scripts/admin.sh update
```

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|---------|
| `502 Bad Gateway` | Backend container crashed | `docker compose ps` then restart |
| OSRM returns `400` | Coordinates outside PH | Ensure lat: 4.5-21.5, lng: 116-127 |
| Nearby returns empty | POI not imported | Run `./scripts/import-poi.sh` |
| Geocode returns empty | Photon data missing | Run `./scripts/import-photon.sh` |
| Walking route fails | Valhalla tiles not built | `docker compose logs valhalla` — wait for build |
| Isochrone fails | Valhalla not ready | Check `/health` endpoint for valhalla status |
| `401 Unauthorized` | Wrong API key | Check `nginx/api_keys.conf`, reload nginx |
| High memory (>20GB) | Normal | OSRM(12G) + Valhalla(6G) + Photon(3G) |
| SSL expired | Cert not renewed | `./scripts/admin.sh ssl-renew` |
| Container won't start | Port conflict | `lsof -i :80` / `lsof -i :5432` |

---

## Feature Comparison vs Google Maps

| Google Maps API | WeKonnek Endpoint | Engine |
|----------------|-----------------|--------|
| Directions API | `/route/v1/{profile}/{coords}` | OSRM (driving) / Valhalla (walk/bike) |
| Distance Matrix API | `/matrix` | OSRM |
| Roads API (Snap to Roads) | `/match` | OSRM |
| Route Optimization API | `/trip` | OSRM |
| Geocoding API (forward) | `/geocode` | Photon + PostGIS |
| Geocoding API (reverse) | `/reverse` | PostGIS |
| Places Autocomplete | `/autocomplete` | Photon + PostGIS |
| Places Nearby Search | `/nearby` | PostGIS |
| Places Details | `/place/:id` | PostGIS |
| Elevation API | `/elevation` | Valhalla (SRTM) |
| — (premium) | `/isochrone` | Valhalla |

---

## Cost Comparison

| | Google Maps APIs | WeKonnek Self-Hosted |
|--|------------------|---------------------|
| Routing (per 1K requests) | $5-10 | **$0** |
| Distance Matrix (per 1K elements) | $5-10 | **$0** |
| Places (per 1K requests) | $17-32 | **$0** |
| Geocoding (per 1K) | $5-10 | **$0** |
| Server cost (monthly) | N/A | **$100-200** (VPS) |
| **10K routes + 50K searches/mo** | **~$500-1,000/mo** | **~$100-200/mo** |
| **100K+ requests/day** | **~$3,000-5,000/mo** | **~$150-300/mo** |

> At scale, self-hosting saves **90-95%** vs Google Maps Platform.

---

## Security Checklist

- [ ] Changed default DB password in `.env`
- [ ] Set strong API keys in `nginx/api_keys.conf`
- [ ] SSH key-only access (no password login)
- [ ] UFW firewall active (SSH + HTTP + HTTPS only)
- [ ] SSL/HTTPS enabled with auto-renewal
- [ ] fail2ban running
- [ ] PostgreSQL port (5432) NOT exposed to internet
- [ ] OSRM port (5000) NOT exposed to internet
- [ ] Valhalla port (8002) NOT exposed to internet
- [ ] Photon port (2322) NOT exposed to internet
- [ ] Watchtower auto-updating containers

> **Production tip**: Remove `ports` mappings for all internal services in `docker-compose.yml`. Only Nginx (80/443) should be publicly accessible.
