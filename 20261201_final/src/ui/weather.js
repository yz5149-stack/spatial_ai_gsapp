// Real weather for the store's real place, from Open-Meteo (open-meteo.com, no key needed),
// fetched in the browser. Hourly values: temperature (°C), snowfall (cm), wind (km/h), cloud (%).

const VARS = 'temperature_2m,snowfall,wind_speed_10m,cloud_cover';

async function getJSON(url, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function hourly(json) {
  const h = json.hourly;
  const off = json.utc_offset_seconds ?? 0;
  return h.time.map((t, i) => {
    const [d, hm] = t.split('T');
    const [Y, Mo, D] = d.split('-').map(Number); const [hh, mm] = hm.split(':').map(Number);
    return {
      local: t, hour: hh,
      date: new Date(Date.UTC(Y, Mo - 1, D, hh, mm) - off * 1000),
      weather: { temperature: h.temperature_2m[i], snowfall: h.snowfall[i], wind: h.wind_speed_10m[i], cloud: h.cloud_cover[i] },
    };
  });
}

// One day of hours: a past date from the archive, or today from the forecast
export async function fetchDay(place, dateStr = null) {
  const base = `latitude=${place.lat}&longitude=${place.lon}&hourly=${VARS}&timezone=${encodeURIComponent(place.tz)}`;
  if (dateStr) {
    const json = await getJSON(`https://archive-api.open-meteo.com/v1/archive?${base}&start_date=${dateStr}&end_date=${dateStr}`);
    return { hours: hourly(json), source: 'Open-Meteo historical archive (ERA5)' };
  }
  const json = await getJSON(`https://api.open-meteo.com/v1/forecast?${base}&past_days=0&forecast_days=1`);
  return { hours: hourly(json), source: 'Open-Meteo forecast, live' };
}
