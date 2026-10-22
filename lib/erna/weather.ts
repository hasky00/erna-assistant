/**
 * Weather via Open-Meteo (https://open-meteo.com). Free, no API key.
 * Two calls: geocode the place name, then fetch the forecast.
 *
 * Privacy: Erna never reads device location. The place comes from what the
 * user typed, or from a memory the user chose to tell Erna in chat.
 */

const USER_AGENT = "ErnaAssistant/1.0 (+https://haskylabs.com)";
const MAX_DAYS = 7;

// WMO weather interpretation codes -> plain words.
const WMO: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  56: "freezing drizzle",
  57: "heavy freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light showers",
  81: "showers",
  82: "violent showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with heavy hail",
};

function describe(code: number | null | undefined) {
  if (typeof code !== "number") return "unknown";
  return WMO[code] ?? `weather code ${code}`;
}

type GeoResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

async function geocode(location: string): Promise<GeoResult | null> {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json" +
    `&name=${encodeURIComponent(location)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status}).`);
  const data = (await res.json()) as { results?: GeoResult[] };
  return data.results?.[0] ?? null;
}

export async function getWeather(locationRaw: string, daysRaw?: unknown) {
  const location = locationRaw.trim();
  if (!location) {
    return {
      ok: false,
      error:
        "No location given. Ask the user which city they want the weather for (Erna does not read device location).",
    };
  }

  let days = Number(daysRaw);
  if (!Number.isFinite(days) || days < 1) days = 1;
  days = Math.min(Math.floor(days), MAX_DAYS);

  const place = await geocode(location);
  if (!place) return { ok: false, error: `Could not find a place called "${location}".` };

  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    timezone: "auto",
    forecast_days: String(days),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset",
    wind_speed_unit: "ms",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) return { ok: false, error: `Weather service failed (${res.status}).` };

  const data = (await res.json()) as {
    timezone?: string;
    current?: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      wind_speed_10m: number;
      weather_code: number;
      is_day: number;
    };
    daily?: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
      precipitation_probability_max: (number | null)[];
      wind_speed_10m_max: number[];
      sunrise: string[];
      sunset: string[];
    };
  };

  const c = data.current;
  const d = data.daily;

  return {
    ok: true,
    source: "open-meteo.com",
    location: {
      name: place.name,
      region: place.admin1 ?? null,
      country: place.country ?? null,
      timezone: data.timezone ?? place.timezone ?? null,
    },
    units: { temperature: "°C", wind: "m/s", precipitation: "mm" },
    current: c
      ? {
          time: c.time,
          temperature: c.temperature_2m,
          feels_like: c.apparent_temperature,
          humidity_percent: c.relative_humidity_2m,
          wind: c.wind_speed_10m,
          condition: describe(c.weather_code),
          is_day: c.is_day === 1,
        }
      : null,
    daily: d
      ? d.time.map((date, i) => ({
          date,
          condition: describe(d.weather_code[i]),
          high: d.temperature_2m_max[i],
          low: d.temperature_2m_min[i],
          precipitation_mm: d.precipitation_sum[i],
          rain_chance_percent: d.precipitation_probability_max[i] ?? null,
          wind_max: d.wind_speed_10m_max[i],
          sunrise: d.sunrise[i],
          sunset: d.sunset[i],
        }))
      : [],
  };
}
