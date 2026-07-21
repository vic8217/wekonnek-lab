# WeKonnek Routing Server — DigitalOcean Droplet Deployment Guide

> Deploy a full self-hosted Google Maps alternative on a DigitalOcean Droplet.
> Replaces Google Directions, Distance Matrix, Geocoding, Places, and Elevation APIs
> using OSRM + Valhalla + Photon + PostGIS — saving 90-95% at scale.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Create the DigitalOcean Droplet](#2-create-the-digitalocean-droplet)
3. [Initial Server Setup](#3-initial-server-setup)
4. [Install Docker](#4-install-docker)
5. [Clone & Configure the Project](#5-clone--configure-the-project)
6. [Set Up Security (Firewall, SSH, fail2ban)](#6-set-up-security)
7. [Build OSRM Map Data](#7-build-osrm-map-data)
8. [Start All Services](#8-start-all-services)
9. [Import POI Data](#9-import-poi-data)
10. [Set Up Domain & SSL](#10-set-up-domain--ssl)
11. [Verify Everything Works](#11-verify-everything-works)
12. [Connect Your Apps](#12-connect-your-apps)
13. [Maintenance & Operations](#13-maintenance--operations)
14. [Monitoring & Alerts](#14-monitoring--alerts)
15. [Troubleshooting](#15-troubleshooting)
16. [Cost Breakdown](#16-cost-breakdown)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    DigitalOcean Droplet                       │
│                  (SGP1 — Singapore region)                    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │               NGINX Gateway (:80 / :443)               │  │
│  │       SSL termination • API key auth • Rate limit      │  │
│  │                  Response caching                       │  │
│  └────────────┬───────────────────────────┬───────────────┘  │
│               │                           │                   │
│  ┌────────────▼────────────┐  ┌──────────▼──────────────┐   │
│  │     POI API (Express)   │  │   OSRM Direct Access    │   │
│  │       :3100             │  │   (via Nginx proxy)     │   │
│  └───┬──────┬──────┬───┬──┘  └──────────────────────────┘   │
│      │      │      │   │                                     │
│  ┌───▼──┐┌──▼──┐┌──▼──┐┌──▼──────────┐                     │
│  │ OSRM ││Valh.││Phot.││  PostGIS    │                      │
│  │:5000 ││:8002││:2322 ││  :5432     │                      │
│  │drive ││walk ││geo-  ││  POI data  │                      │
│  │matrix││bike ││code  ││  spatial   │                      │
│  │match ││moto ││search││  queries   │                      │
│  │trip  ││iso  ││      ││            │                      │
│  └──────┘└─────┘└──────┘└────────────┘                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Watchtower — Auto-updates container images at 4 AM    │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

| Service | Container | Internal Port | Purpose |
|---------|-----------|---------------|---------|
| OSRM | wekonnek-osrm | 5000 | Driving routes, distance matrix, map matching, trip optimization |
| Valhalla | wekonnek-valhalla | 8002 | Walking/cycling/motorcycle routing, isochrones, elevation |
| Photon | wekonnek-photon | 2322 | Forward geocoding, autocomplete (OSM-based) |
| PostGIS | wekonnek-poi-db | 5432 | POI storage, reverse geocoding, spatial queries |
| POI API | wekonnek-poi-api | 3100 | Express.js API aggregating all engines |
| Nginx | wekonnek-routing-gateway | 80/443 | Gateway, SSL, API key auth, rate limiting, caching |
| Watchtower | wekonnek-watchtower | — | Auto-update containers nightly |

---

## 2. Create the DigitalOcean Droplet

### Login to DigitalOcean

Go to [cloud.digitalocean.com](https://cloud.digitalocean.com) and click **Create → Droplets**.

### Droplet Configuration

| Setting | Value |
|---------|-------|
| **Region** | **Singapore (SGP1)** — lowest latency to Philippines |
| **Image** | **Ubuntu 24.04 LTS** |
| **Size** | See table below |
| **Authentication** | **SSH Key** (recommended) or Password |
| **Hostname** | `wekonnek-routing` |
| **VPC** | Default VPC |
| **Backups** | Enable ($4-8/mo extra — recommended) |

### Recommended Droplet Sizes

| Tier | Droplet Plan | vCPU | RAM | Storage | Monthly Cost | Use Case |
|------|-------------|------|-----|---------|-------------|----------|
| **Minimum** | General Purpose 32GB | 8 vCPU | 32 GB | 400 GB | **$192/mo** | Small-medium traffic |
| **Recommended** | General Purpose 64GB | 16 vCPU | 64 GB | 500 GB | **$384/mo** | Production with room to grow |
| **Budget** | Premium AMD 32GB | 8 vCPU | 32 GB | 320 GB | **$168/mo** | Cost-optimized production |

> **Why 32GB minimum?** OSRM uses ~8-12 GB, Valhalla ~4-6 GB, Photon ~2-4 GB, PostGIS ~1-2 GB.
> Total baseline memory is ~20 GB, leaving headroom for OS and spikes.

### Create the Droplet

Click **Create Droplet** and wait ~60 seconds. Note the **public IP address** (e.g. `159.89.xxx.xxx`).

---

## 3. Initial Server Setup

### SSH into the Droplet

```bash
ssh root@YOUR_DROPLET_IP
```

### Create a deploy user (don't run services as root)

```bash
adduser deploy
usermod -aG sudo deploy

# Copy SSH keys to the new user
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

### Update the system

```bash
apt update && apt upgrade -y
apt install -y curl wget git htop unzip jq net-tools
```

### Set the timezone

```bash
timedatectl set-timezone Asia/Manila
```

### Configure swap (important for 32GB droplets)

```bash
fallocate -l 8G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Optimize swap behavior
echo 'vm.swappiness=10' >> /etc/sysctl.conf
echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
sysctl -p
```

---

## 4. Install Docker

```bash
# Install Docker Engine
curl -fsSL https://get.docker.com | sh

# Add deploy user to docker group
usermod -aG docker deploy

# Enable Docker to start on boot
systemctl enable docker
systemctl start docker

# Verify
docker --version
docker compose version
```

Expected output:
```
Docker version 27.x.x
Docker Compose version v2.x.x
```

### Switch to deploy user for remaining steps

```bash
su - deploy
```

---

## 5. Clone & Configure the Project

### Clone the repository

```bash
cd /opt
sudo git clone https://github.com/YOUR_ORG/wekonnek-1.git
sudo chown -R deploy:deploy wekonnek-1
cd wekonnek-1/routing-server
```

### Configure environment variables

```bash
cp .env.example .env
nano .env
```

Set these values:

```env
# Your domain (point DNS A record to Droplet IP first)
DOMAIN=route.wekonnek.com
ADMIN_EMAIL=admin@wekonnek.com

# Strong database password (generate one)
DB_USER=wekonnek
DB_PASSWORD=PASTE_STRONG_PASSWORD_HERE

# API key for Nginx auth
ROUTING_API_KEY=whp_routing_PASTE_GENERATED_KEY_HERE
```

Generate secure passwords and keys:

```bash
# Generate DB password
openssl rand -base64 32

# Generate API keys
openssl rand -hex 24
```

### Configure API keys

```bash
nano nginx/api_keys.conf
```

Replace the default dev key with production keys:

```nginx
map $api_key $valid_api_keys {
    default "";

    # Backend server key
    "whp_backend_prod_YOUR_KEY_1"    "valid";

    # Customer mobile app key
    "whp_customer_app_YOUR_KEY_2"    "valid";

    # Provider/Rider app key
    "whp_provider_app_YOUR_KEY_3"    "valid";

    # Admin dashboard key
    "whp_admin_portal_YOUR_KEY_4"    "valid";
}
```

---

## 6. Set Up Security

### Configure UFW Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
sudo ufw status
```

Expected output:
```
Status: active
To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

> **Important:** Do NOT open ports 5000, 8002, 2322, 3100, or 5432 to the internet.
> All traffic goes through Nginx on port 80/443.

### Install fail2ban

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

### Disable password SSH login

```bash
sudo nano /etc/ssh/sshd_config
```

Set these values:
```
PasswordAuthentication no
PermitRootLogin prohibit-password
```

```bash
sudo systemctl restart sshd
```

### Enable automatic security updates

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

---

## 7. Build OSRM Map Data

This downloads the Philippines OpenStreetMap extract (~570 MB) and builds the driving routing graph.
Takes **10-30 minutes** depending on CPU.

```bash
cd /opt/wekonnek-1/routing-server
chmod +x scripts/*.sh
./scripts/build-osrm.sh car
```

The script runs 4 steps:
1. **Download** — Philippines OSM extract from Geofabrik (~570 MB)
2. **Extract** — Parse road network from OSM data (~5-10 min)
3. **Partition** — Build MLD graph partitions (~1-2 min)
4. **Customize** — Optimize routing graph (~1-2 min)

Verify the data was built:

```bash
ls -lh data/osrm/philippines-latest.osrm
# Should exist and be several hundred MB
```

---

## 8. Start All Services

### Pull images and build

```bash
cd /opt/wekonnek-1/routing-server

# Pull pre-built images
docker compose pull

# Build the POI API image
docker compose build poi-api

# Start everything
docker compose up -d
```

### Verify containers are running

```bash
docker compose ps
```

Expected output (after a few minutes):
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

> **Valhalla** automatically downloads PH map data and builds routing tiles on first start.
> This takes **30-60 minutes**. Check progress with:
> ```bash
> docker compose logs -f valhalla
> ```
> Wait until you see: `Valhalla service started`

### Quick health check

```bash
curl http://localhost/health | jq .
```

---

## 9. Import POI Data

### Install osm2pgsql

```bash
sudo apt install -y osm2pgsql
```

### Import Philippines POIs into PostGIS

```bash
./scripts/import-poi.sh
```

This downloads the same PH OSM extract and imports Points of Interest (restaurants, gas stations, hospitals, banks, malls, etc.) into PostGIS.

### Import Photon geocoding data (optional but recommended)

```bash
./scripts/import-photon.sh
```

> This downloads the Photon geocoding index (~8 GB compressed).
> It enables full address-level forward geocoding and autocomplete.
> Skip this if you only need POI-level geocoding (which PostGIS handles).

### Verify POI data

```bash
# Check POI count
docker compose exec postgres psql -U wekonnek -d wekonnek_poi \
  -c "SELECT category, COUNT(*) FROM pois GROUP BY category ORDER BY count DESC;"
```

---

## 10. Set Up Domain & SSL

### Point your domain to the Droplet

In your DNS provider (e.g. DigitalOcean Networking, Cloudflare, Namecheap):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | route | YOUR_DROPLET_IP | 300 |

Wait for DNS propagation (1-5 minutes):

```bash
dig route.wekonnek.com +short
# Should return your Droplet IP
```

### Get SSL certificate with Let's Encrypt

```bash
./scripts/ssl-setup.sh route.wekonnek.com admin@wekonnek.com
```

This will:
1. Install Certbot
2. Temporarily stop Nginx
3. Request a certificate from Let's Encrypt
4. Copy the certificate to `nginx/ssl/`
5. Restart Nginx

### Enable HTTPS in Nginx

```bash
nano nginx/conf.d/default.conf
```

Make these changes:

1. **Uncomment** the HTTP → HTTPS redirect block (lines near the top):
```nginx
server {
    listen 80;
    server_name route.wekonnek.com;
    return 301 https://$server_name$request_uri;
}
```

2. **Uncomment** the HTTPS listener in the main server block:
```nginx
listen 443 ssl http2;
ssl_certificate     /etc/nginx/ssl/fullchain.pem;
ssl_certificate_key /etc/nginx/ssl/privkey.pem;
```

3. **Remove** or comment out `listen 80;` from the main server block.

4. Reload Nginx:
```bash
docker compose exec nginx nginx -s reload
```

### Set up auto-renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Add cron job (auto-renews every 60 days)
(crontab -l 2>/dev/null; echo "0 3 1 */2 * /opt/wekonnek-1/routing-server/scripts/admin.sh ssl-renew") | crontab -
```

---

## 11. Verify Everything Works

Run these tests from your local machine (replace domain/IP):

### Health check (no auth required)

```bash
curl https://route.wekonnek.com/health | jq .
```

Expected response:
```json
{
  "status": "ok",
  "services": {
    "database": { "status": "ok" },
    "osrm": { "status": "ok" },
    "valhalla": { "status": "ok" },
    "photon": { "status": "ok" }
  }
}
```

### Driving route — Manila to Makati

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  "https://route.wekonnek.com/route/v1/driving/120.9842,14.5995;121.0244,14.5547?steps=true" | jq .
```

### Walking route — Ayala to Greenbelt

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  "https://route.wekonnek.com/route/v1/walking/121.0244,14.5547;121.0212,14.5518?steps=true" | jq .
```

### Distance matrix

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  "https://route.wekonnek.com/matrix?origins=120.9842,14.5995;121.0244,14.5547&destinations=121.0454,14.5500" | jq .
```

### Nearby POI search

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  "https://route.wekonnek.com/nearby?lat=14.5547&lng=121.0244&radius=2000&category=food" | jq .
```

### Forward geocoding

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  "https://route.wekonnek.com/geocode?q=Jollibee+Makati" | jq .
```

### Reverse geocoding

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
  "https://route.wekonnek.com/reverse?lat=14.5547&lng=121.0244" | jq .
```

### Swagger API docs (no auth required)

Open in browser: `https://route.wekonnek.com/docs`

---

## 12. Connect Your Apps

### NestJS Backend (.env)

```env
# Add to WeKonnek-backend/backend/.env
ROUTING_SERVER_URL=https://route.wekonnek.com
ROUTING_API_KEY=whp_backend_prod_YOUR_KEY
```

### NestJS Service Example

```typescript
// Example: Get driving directions
const routeUrl = `${process.env.ROUTING_SERVER_URL}/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?steps=true`;
const response = await fetch(routeUrl, {
  headers: { 'X-API-Key': process.env.ROUTING_API_KEY },
});
const data = await response.json();
// data.routes[0].distance.text → "10.2 km"
// data.routes[0].duration.text → "14 min"
// data.routes[0].legs[0].steps → turn-by-turn instructions
```

### Flutter / Mobile App

```dart
class RoutingConfig {
  static const String baseUrl = 'https://route.wekonnek.com';
  static const String apiKey = 'whp_customer_app_YOUR_KEY';

  static Map<String, String> get headers => {'X-API-Key': apiKey};
}

// Driving directions
Future<RouteResult> getDirections(LatLng origin, LatLng dest) async {
  final url = '${RoutingConfig.baseUrl}/route/v1/driving/'
      '${origin.longitude},${origin.latitude};${dest.longitude},${dest.latitude}'
      '?steps=true&geometries=polyline';
  final res = await http.get(Uri.parse(url), headers: RoutingConfig.headers);
  return RouteResult.fromJson(jsonDecode(res.body));
}

// Nearby search
Future<List<POI>> searchNearby(LatLng center, {String? category}) async {
  final url = '${RoutingConfig.baseUrl}/nearby'
      '?lat=${center.latitude}&lng=${center.longitude}&radius=2000'
      '${category != null ? '&category=$category' : ''}';
  final res = await http.get(Uri.parse(url), headers: RoutingConfig.headers);
  final data = jsonDecode(res.body);
  return (data['results'] as List).map((r) => POI.fromJson(r)).toList();
}
```

### Next.js Frontend (via proxy)

```typescript
// next.config.ts — proxy routing API through frontend
async rewrites() {
  return [
    {
      source: '/api/routing/:path*',
      destination: 'https://route.wekonnek.com/:path*',
    },
  ];
}
```

---

## 13. Maintenance & Operations

### Daily Commands

```bash
# Check service status
./scripts/admin.sh status

# View logs (all services)
./scripts/admin.sh logs

# View logs (specific service)
./scripts/admin.sh logs osrm-backend
./scripts/admin.sh logs valhalla
./scripts/admin.sh logs poi-api

# Restart a service
./scripts/admin.sh restart poi-api
./scripts/admin.sh restart        # restart all
```

### Monthly: Update Map Data

Philippines OpenStreetMap data is updated daily. Rebuild monthly to get new roads, POIs, etc.

```bash
# Rebuild driving routes (OSRM)
./scripts/admin.sh rebuild

# Rebuild walking/cycling routes (Valhalla)
./scripts/admin.sh rebuild-val

# Refresh POI database
./scripts/import-poi.sh
```

### Backup Database

```bash
# Manual backup
./scripts/admin.sh backup
# Saved to ./backups/wekonnek_poi_YYYYMMDD_HHMMSS.sql.gz

# Auto backup via cron (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/wekonnek-1/routing-server/scripts/admin.sh backup") | crontab -
```

### Update Container Images

```bash
./scripts/admin.sh update
```

### Renew SSL Certificate

```bash
./scripts/admin.sh ssl-renew
```

---

## 14. Monitoring & Alerts

### DigitalOcean Monitoring (free)

1. Go to your Droplet → **Monitoring** tab
2. Enable **Droplet Metrics**
3. Set up alerts:
   - CPU > 80% for 5 min
   - Memory > 90% for 5 min
   - Disk > 85%

### Health Check Monitoring

Set up an external uptime monitor (UptimeRobot, Pingdom, or DigitalOcean Uptime) to ping:

```
https://route.wekonnek.com/health
```

Alert if response is not 200 or `status` is not `ok`.

### Quick Status Check Script

```bash
# Add to /opt/wekonnek-1/routing-server/scripts/quick-check.sh
#!/bin/bash
echo "=== Memory Usage ==="
free -h
echo ""
echo "=== Disk Usage ==="
df -h /
echo ""
echo "=== Docker Containers ==="
docker compose ps
echo ""
echo "=== Health Check ==="
curl -s http://localhost/health | jq '.services | to_entries[] | "\(.key): \(.value.status)"'
```

---

## 15. Troubleshooting

| Problem | Cause | Solution |
|---------|-------|---------|
| `502 Bad Gateway` | Backend container crashed | `docker compose ps` → `docker compose restart poi-api` |
| OSRM returns `400 Bad Request` | Coordinates outside Philippines | Ensure lat: 4.5-21.5, lng: 116-127 |
| Nearby search returns empty | POI data not imported | Run `./scripts/import-poi.sh` |
| Geocode returns empty | Photon data not imported | Run `./scripts/import-photon.sh` |
| Walking/cycling route fails | Valhalla still building tiles | `docker compose logs valhalla` — wait for completion |
| Isochrone fails | Valhalla not ready | Check `/health` for valhalla status |
| `401 Unauthorized` | Wrong or missing API key | Check `nginx/api_keys.conf`, reload: `docker compose exec nginx nginx -s reload` |
| High memory (>20GB) | Normal operation | OSRM(12G) + Valhalla(6G) + Photon(3G) + PostGIS(1G) |
| SSL certificate expired | Auto-renewal failed | `./scripts/admin.sh ssl-renew` |
| Container won't start | Port conflict | `lsof -i :80` or `lsof -i :5432`, kill conflicting process |
| Valhalla keeps restarting | Not enough RAM | Upgrade Droplet or reduce `memory` limits in docker-compose.yml |
| OSRM `osrm-routed` crash | Corrupted data files | Rebuild: `./scripts/build-osrm.sh car` |
| Slow geocoding | Photon index not loaded | Check `docker compose logs photon`, may need 1-2 min to load |
| `ECONNREFUSED` from POI API | Upstream service down | `docker compose restart osrm-backend valhalla` |

### View detailed logs

```bash
# All services
docker compose logs --tail=100

# Specific service with follow
docker compose logs -f osrm-backend

# Nginx access/error logs
tail -f logs/nginx/access.log
tail -f logs/nginx/error.log
```

### Emergency restart

```bash
docker compose down
docker compose up -d
```

---

## 16. Cost Breakdown

### DigitalOcean Monthly Cost

| Item | Cost |
|------|------|
| Droplet (General Purpose 32GB) | $192/mo |
| Backups (20% of Droplet) | $38/mo |
| Domain (optional, via registrar) | ~$1/mo |
| **Total** | **~$230/mo** |

### Google Maps vs Self-Hosted Comparison

| Usage Level | Google Maps APIs | WeKonnek Self-Hosted | Savings |
|-------------|-----------------|---------------------|---------|
| 10K routes + 50K searches/mo | ~$500-1,000/mo | ~$230/mo | **55-77%** |
| 50K routes + 200K searches/mo | ~$2,500-4,000/mo | ~$230/mo | **90-94%** |
| 100K+ requests/day | ~$3,000-5,000/mo | ~$300/mo | **90-94%** |

> The self-hosted cost is **fixed** regardless of request volume.
> Google Maps charges **per request** and costs grow linearly with traffic.

---

## Quick Reference Card

```
SSH:              ssh deploy@YOUR_DROPLET_IP
Project dir:      /opt/wekonnek-1/routing-server
Health check:     curl https://route.wekonnek.com/health
API docs:         https://route.wekonnek.com/docs
Status:           ./scripts/admin.sh status
Logs:             ./scripts/admin.sh logs [service]
Restart:          ./scripts/admin.sh restart [service]
Rebuild maps:     ./scripts/admin.sh rebuild
Backup DB:        ./scripts/admin.sh backup
Update images:    ./scripts/admin.sh update
SSL renew:        ./scripts/admin.sh ssl-renew
```

---

## Security Checklist

Before going to production, verify:

- [ ] Changed default DB password in `.env`
- [ ] Generated strong API keys in `nginx/api_keys.conf`
- [ ] SSH key-only access (password login disabled)
- [ ] UFW firewall active (only SSH + HTTP + HTTPS open)
- [ ] SSL/HTTPS enabled with auto-renewal cron
- [ ] fail2ban running
- [ ] Internal ports (5000, 8002, 2322, 5432, 3100) NOT exposed to internet
- [ ] Removed port mappings for internal services in `docker-compose.yml`
- [ ] Watchtower auto-updating containers
- [ ] DigitalOcean backups enabled
- [ ] Uptime monitoring configured
- [ ] Tested all API endpoints

---

## Production Hardening: Lock Down Internal Ports

For production, edit `docker-compose.yml` and remove the `ports` section from all services
except Nginx. Services communicate internally via the Docker network.

```yaml
# REMOVE these port mappings in production:
# osrm-backend:     ports: ["5000:5000"]   ← REMOVE
# valhalla:         ports: ["8002:8002"]   ← REMOVE
# photon:           ports: ["2322:2322"]   ← REMOVE
# postgres:         ports: ["5432:5432"]   ← REMOVE
# poi-api:          ports: ["3100:3100"]   ← REMOVE

# KEEP only Nginx:
# nginx:            ports: ["80:80", "443:443"]   ← KEEP
```

This ensures all traffic goes through Nginx with API key authentication and rate limiting.
