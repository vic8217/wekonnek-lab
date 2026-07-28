import { NextRequest, NextResponse } from 'next/server';

type NominatimResult = {
	lat?: string;
	lon?: string;
	display_name?: string;
};

export async function GET(request: NextRequest) {
	const query = request.nextUrl.searchParams.get('q')?.trim();
	if (!query || query.length < 2) {
		return NextResponse.json({ status: 'error', results: [] }, { status: 400 });
	}

	try {
		const params = new URLSearchParams({
			q: query,
			format: 'jsonv2',
			countrycodes: 'ph',
			limit: '1',
		});
		const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
			headers: {
				'User-Agent': 'WeKonnek/1.0 (merchant address lookup)',
				Accept: 'application/json',
			},
			next: { revalidate: 86400 },
		});
		if (!response.ok) {
			return NextResponse.json({ status: 'error', results: [] }, { status: 502 });
		}

		const matches = await response.json() as NominatimResult[];
		const results = matches.flatMap(match => {
			const lat = Number(match.lat);
			const lng = Number(match.lon);
			return Number.isFinite(lat) && Number.isFinite(lng)
				? [{ display_name: match.display_name || query, location: { lat, lng } }]
				: [];
		});
		return NextResponse.json({ status: 'ok', results });
	} catch {
		return NextResponse.json({ status: 'error', results: [] }, { status: 502 });
	}
}
