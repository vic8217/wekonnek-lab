# WeKonnek Routing Server v2.0 — API Reference

**Full Google Maps Platform Alternative — Self-Hosted**

## Base URL
```
https://route.yourdomain.com
```

## Authentication
All endpoints (except `/health`, `/ready`, `/docs`) require an API key:

**Header:**
```
X-API-Key: your-api-key-here
```

**Query param:**
```
?api_key=your-api-key-here
```

---

## Endpoint Overview

| Category | Endpoint | Google Maps Equivalent |
|----------|----------|----------------------|
| **Routing** | `GET /route/v1/{profile}/{coordinates}` | Directions API |
| **Matrix** | `GET /matrix` | Distance Matrix API |
| **Matching** | `GET/POST /match` | Roads API (Snap to Roads) |
| **Trip** | `GET /trip` | Route Optimization API |
| **Geocode** | `GET /geocode` | Geocoding API (forward) |
| **Autocomplete** | `GET /autocomplete` | Places Autocomplete API |
| **Reverse** | `GET /reverse` | Geocoding API (reverse) |
| **Nearby** | `GET /nearby` | Places Nearby Search |
| **Place** | `GET /place/:id` | Places Details API |
| **Categories** | `GET /categories` | — |
| **Isochrone** | `GET /isochrone` | — (premium feature) |
| **Elevation** | `GET/POST /elevation` | Elevation API |
| **Health** | `GET /health` | — |

---

## 1. Routing (Directions)

### `GET /route/v1/{profile}/{coordinates}`

Multi-modal turn-by-turn directions.

**Profiles:**

| Profile | Engine | Description |
|---------|--------|-------------|
| `driving` | OSRM | Car routing (default) |
| `walking` | Valhalla | Pedestrian routing |
| `cycling` | Valhalla | Bicycle routing |
| `motorcycle` | Valhalla | Motorcycle routing |

**Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| profile | path | `driving` | `driving`, `walking`, `cycling`, `motorcycle` |
| coordinates | path | — | `lon1,lat1;lon2,lat2` (waypoints separated by `;`) |
| overview | query | `full` | `full`, `simplified`, `false` |
| geometries | query | `polyline` | `polyline`, `polyline6`, `geojson` |
| steps | query | `false` | Include turn-by-turn steps |
| alternatives | query | `false` | Return alternative routes |
| exclude | query | — | `toll`, `motorway` (driving only) |

**Example:**
```bash
# Driving
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/route/v1/driving/120.9842,14.5995;121.0244,14.5547?steps=true"

# Walking
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/route/v1/walking/120.9842,14.5995;120.990,14.602"

# Cycling
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/route/v1/cycling/120.9842,14.5995;121.0244,14.5547"
```

**Response:**
```json
{
  "status": "ok",
  "profile": "driving",
  "engine": "osrm",
  "waypoints": [
    { "name": "EDSA", "location": { "lng": 120.9842, "lat": 14.5995 } }
  ],
  "routes": [
    {
      "route_index": 0,
      "profile": "driving",
      "distance": { "meters": 8500, "km": "8.5", "text": "8.5 km" },
      "duration": { "seconds": 1200, "minutes": 20, "text": "20 min" },
      "geometry": "encoded_polyline...",
      "legs": [
        {
          "distance": { "meters": 8500, "text": "8.5 km" },
          "duration": { "seconds": 1200, "text": "20 min" },
          "steps": [
            {
              "instruction": "Head south on EDSA",
              "distance": { "meters": 500, "text": "500 m" },
              "duration": { "seconds": 60, "text": "1 min" },
              "name": "EDSA",
              "maneuver": { "type": "depart", "modifier": "south" }
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 2. Distance Matrix

### `GET /matrix`

NxM travel duration/distance matrix between origin-destination pairs.

**Parameters:**

| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| origins | string | — | Yes | Origin coords: `lon,lat;lon,lat` |
| destinations | string | origins | — | Destination coords (defaults to origins for NxN) |
| profile | string | `driving` | — | Routing profile |

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/matrix?origins=120.9842,14.5995;121.0244,14.5547&destinations=121.0,14.55;120.99,14.58"
```

**Response:**
```json
{
  "status": "ok",
  "origin_count": 2,
  "destination_count": 2,
  "rows": [
    {
      "origin_index": 0,
      "origin": { "name": "", "location": { "lng": 120.9842, "lat": 14.5995 } },
      "elements": [
        {
          "destination_index": 0,
          "duration": { "seconds": 900, "text": "15 min" },
          "distance": { "meters": 5200, "text": "5.2 km" },
          "status": "ok"
        }
      ]
    }
  ]
}
```

---

## 3. Map Matching (Snap to Road)

### `GET /match` or `POST /match`

Snap GPS traces to the road network.

**GET Parameters:**

| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| coordinates | string | — | Yes | GPS points: `lon,lat;lon,lat;lon,lat` |
| profile | string | `driving` | — | Routing profile |
| geometries | string | `geojson` | — | `geojson`, `polyline`, `polyline6` |
| steps | string | `false` | — | Include turn-by-turn steps |
| tidy | string | `false` | — | Remove noisy points |
| timestamps | string | — | — | Unix timestamps per point (`;`-separated) |
| radiuses | string | — | — | Search radius per point in meters (`;`-separated) |

**POST Body:**
```json
{
  "coordinates": [[120.9842,14.5995],[120.985,14.600],[120.986,14.601]],
  "timestamps": [1700000000, 1700000010, 1700000020],
  "radiuses": [20, 20, 20]
}
```

**Response:**
```json
{
  "status": "ok",
  "matchings": [
    {
      "confidence": 0.95,
      "distance": { "meters": 800, "text": "800 m" },
      "duration": { "seconds": 45, "text": "45 sec" },
      "geometry": { "type": "LineString", "coordinates": [...] }
    }
  ],
  "tracepoints": [
    { "index": 0, "status": "matched", "location": { "lng": 120.9843, "lat": 14.5996 } },
    { "index": 1, "status": "matched", "location": { "lng": 120.9851, "lat": 14.6001 } }
  ]
}
```

---

## 4. Trip Optimization (TSP)

### `GET /trip`

Find the optimal visit order for multiple waypoints (Travelling Salesman Problem).

**Parameters:**

| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| coordinates | string | — | Yes | Waypoints: `lon,lat;lon,lat;...` (2-100 points) |
| roundtrip | string | `true` | — | Return to start point |
| source | string | `any` | — | `any` or `first` (fix start point) |
| destination | string | `any` | — | `any` or `last` (fix end point) |
| steps | string | `false` | — | Include turn-by-turn steps |
| overview | string | `full` | — | Route geometry detail |
| geometries | string | `polyline` | — | Geometry format |

**Example (delivery route optimization):**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/trip?coordinates=120.9842,14.5995;121.0244,14.5547;121.0,14.58;120.98,14.57&roundtrip=false&source=first&destination=last"
```

**Response:**
```json
{
  "status": "ok",
  "waypoint_count": 4,
  "optimized_order": [0, 3, 2, 1],
  "trips": [
    {
      "distance": { "meters": 12000, "km": "12.0", "text": "12.0 km" },
      "duration": { "seconds": 2400, "minutes": 40, "text": "40 min" },
      "geometry": "..."
    }
  ],
  "waypoints": [
    { "original_index": 0, "optimized_index": 0, "name": "Start" },
    { "original_index": 1, "optimized_index": 3, "name": "Stop C" }
  ]
}
```

---

## 5. Forward Geocoding

### `GET /geocode`

Convert text/address to geographic coordinates.

**Parameters:**

| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| q | string | — | Yes | Search query (min 2 characters) |
| lat | number | — | — | Bias results near this latitude |
| lng | number | — | — | Bias results near this longitude |
| limit | number | 5 | — | Max results (max 20) |
| lang | string | `en` | — | Language preference |

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/geocode?q=Jollibee+Taft+Manila&lat=14.5995&lng=120.9842"
```

**Response:**
```json
{
  "status": "ok",
  "query": "Jollibee Taft Manila",
  "count": 3,
  "results": [
    {
      "name": "Jollibee",
      "display_name": "Jollibee, Taft Ave, Manila",
      "location": { "lat": 14.5632, "lng": 120.9945 },
      "address": { "street": "Taft Avenue", "city": "Manila" },
      "type": "fast_food",
      "confidence": 0.92
    }
  ]
}
```

---

## 6. Autocomplete / Place Predictions

### `GET /autocomplete`

Fast type-ahead suggestions as the user types.

**Parameters:**

| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| q | string | — | Yes | Search prefix (min 1 character) |
| lat | number | — | — | Bias results near this latitude |
| lng | number | — | — | Bias results near this longitude |
| radius | number | — | — | Restrict to this radius in meters |
| types | string | — | — | Filter by category (e.g., `food`) |
| limit | number | 5 | — | Max predictions (max 10) |

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/autocomplete?q=jol&lat=14.5995&lng=120.9842"
```

**Response:**
```json
{
  "status": "ok",
  "query": "jol",
  "predictions": [
    {
      "place_id": "poi_12345",
      "name": "Jollibee - Rizal Avenue",
      "description": "Fast Food · Manila · 1.2km",
      "location": { "lat": 14.5998, "lng": 120.9850 },
      "category": "food",
      "type": "fast_food",
      "icon": "fastfood"
    }
  ]
}
```

---

## 7. Reverse Geocoding

### `GET /reverse`

Get address from coordinates.

**Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| lat | number | Yes | Latitude |
| lng | number | Yes | Longitude |

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/reverse?lat=14.5995&lng=120.9842"
```

**Response:**
```json
{
  "status": "ok",
  "location": { "lat": 14.5995, "lng": 120.9842 },
  "address": {
    "full": "123 Taft Avenue, Brgy. 123, Manila, Metro Manila",
    "house_number": "123",
    "street": "Taft Avenue",
    "barangay": "Brgy. 123",
    "city": "Manila",
    "province": "Metro Manila",
    "postcode": "1000"
  },
  "distance_meters": 12,
  "source": "address_point"
}
```

---

## 8. Nearby POI Search

### `GET /nearby`

Find points of interest near a location.

**Parameters:**

| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| lat | number | — | Yes | Latitude |
| lng | number | — | Yes | Longitude |
| radius | number | 1000 | — | Search radius in meters (max 50000) |
| category | string | — | — | Top-level category filter |
| subcategory | string | — | — | Subcategory filter |
| q | string | — | — | Keyword search |
| limit | number | 20 | — | Max results (max 100) |
| offset | number | 0 | — | Pagination offset |

**Categories:**

| Category | Subcategories |
|----------|---------------|
| food | restaurant, fast_food, cafe, bar, food_court, ice_cream, bakery |
| shopping | supermarket, convenience, mall, department_store, clothes, electronics |
| health | hospital, clinic, dentist, pharmacy |
| transport | gas_station, parking, bus_station, train_station |
| finance | bank, atm, remittance |
| accommodation | hotel, guest_house |
| tourism | attraction, museum |
| education | school, university, library |
| government | city_hall, police, fire_station, post_office |

---

## 9. Place Details

### `GET /place/:id`

Get full details for a POI, including nearby places.

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/place/12345"
```

**Response:**
```json
{
  "status": "ok",
  "place": {
    "id": 12345,
    "osm_id": 987654,
    "name": "Jollibee - Rizal Avenue",
    "category": "food",
    "subcategory": "fast_food",
    "category_display": "Fast Food",
    "icon": "fastfood",
    "location": { "lat": 14.5998, "lng": 120.985 },
    "address": {
      "full": "123 Rizal Avenue, Manila",
      "street": "Rizal Avenue",
      "city": "Manila"
    },
    "contact": {
      "phone": "+63 2 1234 5678",
      "website": "https://jollibee.com.ph"
    },
    "details": {
      "opening_hours": "Mo-Su 06:00-00:00",
      "cuisine": "chicken;burger",
      "brand": "Jollibee",
      "tags": {}
    },
    "nearby": [
      { "id": 12346, "name": "Mercury Drug", "distance": { "meters": 50, "text": "50m" } }
    ]
  }
}
```

---

## 10. Isochrone (Reachable Area)

### `GET /isochrone`

Get polygon(s) showing the area reachable within a given time or distance.

**Parameters:**

| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| lat | number | — | Yes | Center latitude |
| lng | number | — | Yes | Center longitude |
| range | string | `600` | — | Comma-separated seconds or meters. E.g. `300,600,900` |
| mode | string | `driving` | — | `driving`, `walking`, `cycling`, `motorcycle` |
| metric | string | `time` | — | `time` (seconds) or `distance` (meters) |
| denoise | number | 0.5 | — | Smoothing factor (0-1) |
| generalize | number | 120 | — | Simplification tolerance in meters |
| polygons | string | `true` | — | Return polygons or lines |

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/isochrone?lat=14.5995&lng=120.9842&range=300,600,900&mode=driving"
```

**Response:**
```json
{
  "status": "ok",
  "center": { "lat": 14.5995, "lng": 120.9842 },
  "mode": "driving",
  "metric": "time",
  "isochrones": [
    {
      "index": 0,
      "value": 300,
      "label": "5 min",
      "color": "#ff4444",
      "geometry": { "type": "Polygon", "coordinates": [...] }
    },
    {
      "index": 1,
      "value": 600,
      "label": "10 min",
      "color": "#ff8800",
      "geometry": { "type": "Polygon", "coordinates": [...] }
    }
  ],
  "geojson": { "type": "FeatureCollection", "features": [...] }
}
```

---

## 11. Elevation

### `GET /elevation` or `POST /elevation`

Get elevation/altitude data for points.

**GET Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| points | string | Yes | `lat,lng|lat,lng|...` format (max 500 points) |

**POST Body:**
```json
{
  "points": [[14.5995, 120.9842], [14.5547, 121.0244]]
}
```

**Example:**
```bash
curl -H "X-API-Key: YOUR_KEY" \
  "https://route.yourdomain.com/elevation?points=14.5995,120.9842|14.5547,121.0244"
```

**Response:**
```json
{
  "status": "ok",
  "count": 2,
  "results": [
    { "location": { "lat": 14.5995, "lng": 120.9842 }, "elevation": 12, "elevation_text": "12 m" },
    { "location": { "lat": 14.5547, "lng": 121.0244 }, "elevation": 28, "elevation_text": "28 m" }
  ],
  "summary": { "min": 12, "max": 28, "avg": 20 }
}
```

---

## 12. Health Check

### `GET /health` (no auth required)

Check all backend service health.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-27T10:30:00.000Z",
  "uptime": 86400,
  "version": "2.0.0",
  "services": {
    "database": { "status": "ok", "latency_ms": 2 },
    "osrm": { "status": "ok", "latency_ms": 15, "features": ["driving", "matrix", "match", "trip"] },
    "valhalla": { "status": "ok", "latency_ms": 22, "features": ["walking", "cycling", "motorcycle", "isochrone", "elevation"] },
    "photon": { "status": "ok", "latency_ms": 8, "features": ["geocode", "autocomplete"] }
  },
  "memory": { "rss_mb": 45, "heap_used_mb": 20, "heap_total_mb": 30 }
}
```

---

## Error Codes

| HTTP Code | Meaning |
|-----------|---------|
| 200 | Success |
| 400 | Bad request (missing/invalid params) |
| 401 | Invalid or missing API key |
| 404 | Resource not found (place ID) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 502 | Upstream service error (Valhalla/Photon) |
| 503 | Service unavailable / degraded |
| 504 | Gateway timeout |

---

## Rate Limits

| Endpoint | Rate | Cache |
|----------|------|-------|
| `/route/*` | 50 req/sec per IP | 5 min |
| `/matrix` | 50 req/sec per IP | 5 min |
| `/match`, `/trip` | 50 req/sec per IP | — |
| `/geocode` | 100 req/sec per IP | 30 min |
| `/autocomplete` | 100 req/sec per IP | 5 min |
| `/nearby`, `/reverse` | 100 req/sec per IP | — |
| `/isochrone` | 50 req/sec per IP | 15 min |
| `/elevation` | 100 req/sec per IP | — |
| `/health` | No limit | — |

---

## Architecture

```
Client → Nginx (auth + rate limit + cache)
           ├── POI API (Express)
           │     ├── OSRM     → driving, matrix, match, trip
           │     ├── Valhalla → walking, cycling, motorcycle, isochrone, elevation
           │     ├── Photon   → forward geocoding, autocomplete
           │     └── PostGIS  → nearby, reverse, place details, categories
           └── OSRM (direct /osrm/* passthrough)
```

## Self-Hosting Cost

| Scale | Google Maps Cost | Self-Hosted Cost | Savings |
|-------|-----------------|-----------------|---------|
| 10K routes + 50K searches/mo | ~$500-1,000/mo | ~$80-160/mo (VPS) | 80-90% |
| 100K+ requests/day | ~$3,000-5,000/mo | ~$150-300/mo | 90-95% |
