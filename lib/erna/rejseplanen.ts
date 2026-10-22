// Danish public transport via Rejseplanen API 2.0 (HAFAS ReST, JSON).
// Covers S-trains, regional/IC trains, metro, buses, light rail and harbour buses
// for all of Denmark. Needs an access key from Rejseplan Labs
// (https://labs.rejseplan.dk) in REJSEPLANEN_ACCESS_ID.
//
// Endpoints used (all under https://www.rejseplanen.dk/api/):
//   location.name    – resolve a typed place name to a stop/address with an id
//   trip             – journey planner from origin to destination
//   departureBoard   – next departures from a stop
// Every request carries accessId=<key>&format=json.

import { optionalEnv } from "@/lib/env";

const BASE_URL = "https://www.rejseplanen.dk/api";
const USER_AGENT = "ErnaAssistant/1.0 (+https://haskylabs.com)";
const MAX_TRIPS = 3;
const MAX_DEPARTURES = 8;

type RpLocation = {
  id?: string;
  extId?: string;
  name?: string;
  lon?: number;
  lat?: number;
  type?: string;
  products?: number;
};

type RpStop = {
  name?: string;
  type?: string;
  time?: string;
  date?: string;
  rtTime?: string;
  rtDate?: string;
  track?: string;
  rtTrack?: string;
  cancelled?: boolean;
};

type RpLeg = {
  name?: string;
  type?: string;
  category?: string;
  number?: string;
  direction?: string;
  dist?: number;
  duration?: string;
  cancelled?: boolean;
  Origin?: RpStop;
  Destination?: RpStop;
  Notes?: { Note?: Array<{ value?: string; key?: string }> };
  Product?: Array<{ name?: string; catOutL?: string; line?: string; operator?: string }>;
};

type RpTrip = {
  duration?: string;
  transferCount?: number;
  Origin?: RpStop;
  Destination?: RpStop;
  LegList?: { Leg?: RpLeg[] };
};

type RpDeparture = {
  name?: string;
  type?: string;
  stop?: string;
  time?: string;
  date?: string;
  rtTime?: string;
  rtDate?: string;
  direction?: string;
  track?: string;
  rtTrack?: string;
  cancelled?: boolean;
  Product?: Array<{ name?: string; catOutL?: string; line?: string; operator?: string }>;
};

type Failure = { ok: false; error: string };

function accessId(): string | Failure {
  const key = optionalEnv("REJSEPLANEN_ACCESS_ID");
  if (!key) {
    return {
      ok: false,
      error:
        "Rejseplanen is not configured on the server (missing REJSEPLANEN_ACCESS_ID). Tell the user you cannot fetch live Danish departures yet.",
    };
  }
  return key;
}

async function rpGet(path: string, params: Record<string, string | number | undefined>) {
  const key = accessId();
  if (typeof key !== "string") return key;

  const url = new URL(`${BASE_URL}/${path}`);
  url.searchParams.set("accessId", key);
  url.searchParams.set("format", "json");
  url.searchParams.set("lang", "en");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return { ok: false as const, error: "Could not reach Rejseplanen." };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false as const, error: "Rejseplanen rejected the access key." };
  }
  if (response.status === 429) {
    return { ok: false as const, error: "Rejseplanen rate limit reached. Try again in a moment." };
  }
  if (!response.ok) {
    return { ok: false as const, error: `Rejseplanen request failed (${response.status}).` };
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false as const, error: "Rejseplanen returned an unreadable response." };
  }

  // HAFAS reports errors inside a 200 body.
  const err = data.errorCode || data.errorText;
  if (err) {
    return { ok: false as const, error: `Rejseplanen error: ${String(data.errorText || data.errorCode)}` };
  }
  return { ok: true as const, data };
}

function isFailure(x: unknown): x is Failure {
  return typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;
}

// ---------- Locations ----------

export async function searchLocation(query: string) {
  const input = String(query || "").trim();
  if (!input) return { ok: false as const, error: "Empty location query." };

  const res = await rpGet("location.name", { input, maxNo: 6 });
  if (isFailure(res)) return res;

  const raw = res.data.stopLocationOrCoordLocation;
  const list: RpLocation[] = Array.isArray(raw)
    ? raw
        .map((entry: Record<string, RpLocation>) => entry.StopLocation || entry.CoordLocation)
        .filter((x): x is RpLocation => Boolean(x))
    : [];

  const locations = list.map((loc) => ({
    id: loc.id || loc.extId || null,
    extId: loc.extId || null,
    name: loc.name || null,
    kind: loc.type === "ST" || loc.extId ? "stop" : "address",
    lat: loc.lat ?? null,
    lon: loc.lon ?? null,
  }));

  if (!locations.length) {
    return { ok: false as const, error: `No stop or address found for "${input}".` };
  }
  return { ok: true as const, query: input, locations };
}

async function resolve(query: string) {
  const res = await searchLocation(query);
  if (isFailure(res)) return res;
  // Prefer a real stop over an address when both match.
  const stop = res.locations.find((l) => l.kind === "stop") || res.locations[0];
  return { ok: true as const, location: stop };
}

// ---------- Trip planning ----------

function hhmm(t?: string) {
  return t ? t.slice(0, 5) : null;
}

function legMode(leg: RpLeg) {
  const t = (leg.type || "").toUpperCase();
  if (t === "WALK" || t === "TRSF") return "walk";
  if (t === "BIKE") return "bike";
  const cat = (leg.Product?.[0]?.catOutL || leg.category || leg.name || "").toLowerCase();
  if (cat.includes("metro")) return "metro";
  if (cat.includes("bus")) return "bus";
  if (cat.includes("letbane") || cat.includes("light")) return "light rail";
  if (cat.includes("færge") || cat.includes("ferry") || cat.includes("havnebus")) return "ferry";
  if (cat.includes("s-tog") || cat.includes("s-train") || /^S\b/i.test(leg.name || "")) return "s-train";
  if (cat.includes("tog") || cat.includes("train") || cat.includes("ic") || cat.includes("re")) return "train";
  return "transit";
}

function shapeLeg(leg: RpLeg) {
  const mode = legMode(leg);
  const notes = (leg.Notes?.Note || [])
    .map((n) => n.value)
    .filter((v): v is string => Boolean(v))
    .slice(0, 3);

  return {
    mode,
    line: mode === "walk" || mode === "bike" ? null : (leg.Product?.[0]?.line || leg.name || null),
    direction: leg.direction || null,
    from: leg.Origin?.name || null,
    departure: hhmm(leg.Origin?.time),
    departureLive: hhmm(leg.Origin?.rtTime),
    departurePlatform: leg.Origin?.rtTrack || leg.Origin?.track || null,
    to: leg.Destination?.name || null,
    arrival: hhmm(leg.Destination?.time),
    arrivalLive: hhmm(leg.Destination?.rtTime),
    arrivalPlatform: leg.Destination?.rtTrack || leg.Destination?.track || null,
    walkMeters: mode === "walk" && typeof leg.dist === "number" ? leg.dist : null,
    cancelled: Boolean(leg.cancelled),
    notes,
  };
}

function isoDurationToMinutes(d?: string) {
  if (!d) return null;
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(d);
  if (!m) return null;
  return Number(m[1] || 0) * 60 + Number(m[2] || 0);
}

export async function planTrip(input: {
  from: string;
  to: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  arriveBy?: boolean;
}) {
  const [origin, dest] = await Promise.all([resolve(input.from), resolve(input.to)]);
  if (isFailure(origin)) return { ok: false as const, error: `Origin: ${origin.error}` };
  if (isFailure(dest)) return { ok: false as const, error: `Destination: ${dest.error}` };

  const o = origin.location;
  const d = dest.location;

  const params: Record<string, string | number | undefined> = {
    date: input.date,
    time: input.time,
    searchForArrival: input.arriveBy ? 1 : 0,
    numF: MAX_TRIPS,
    passlist: 0,
  };
  if (o.kind === "stop" && o.id) params.originId = o.id;
  else if (o.lat != null && o.lon != null) {
    params.originCoordLat = o.lat;
    params.originCoordLong = o.lon;
    params.originCoordName = o.name || undefined;
  }
  if (d.kind === "stop" && d.id) params.destId = d.id;
  else if (d.lat != null && d.lon != null) {
    params.destCoordLat = d.lat;
    params.destCoordLong = d.lon;
    params.destCoordName = d.name || undefined;
  }

  const res = await rpGet("trip", params);
  if (isFailure(res)) return res;

  const rawTrips = res.data.Trip;
  const trips: RpTrip[] = Array.isArray(rawTrips) ? rawTrips : [];
  if (!trips.length) {
    return { ok: false as const, error: `No journeys found from ${o.name} to ${d.name}.` };
  }

  return {
    ok: true as const,
    origin: o.name,
    destination: d.name,
    date: input.date || null,
    requested: input.arriveBy ? `arrive by ${input.time || "now"}` : `depart ${input.time || "now"}`,
    journeys: trips.slice(0, MAX_TRIPS).map((trip) => {
      const legs = (trip.LegList?.Leg || []).map(shapeLeg);
      const first = legs.find((l) => l.mode !== "walk") || legs[0];
      const last = [...legs].reverse().find((l) => l.mode !== "walk") || legs[legs.length - 1];
      return {
        departure: legs[0]?.departureLive || legs[0]?.departure || null,
        arrival: legs[legs.length - 1]?.arrivalLive || legs[legs.length - 1]?.arrival || null,
        durationMinutes: isoDurationToMinutes(trip.duration),
        changes: typeof trip.transferCount === "number"
          ? trip.transferCount
          : Math.max(0, legs.filter((l) => l.mode !== "walk").length - 1),
        firstVehicleDeparture: first?.departureLive || first?.departure || null,
        lastVehicleArrival: last?.arrivalLive || last?.arrival || null,
        legs,
      };
    }),
    source: "Rejseplanen (rejseplanen.dk)",
  };
}

// ---------- Departure board ----------

export async function departures(input: { stop: string; date?: string; time?: string; limit?: number }) {
  const resolved = await resolve(input.stop);
  if (isFailure(resolved)) return resolved;
  const stop = resolved.location;
  if (stop.kind !== "stop" || !stop.id) {
    return { ok: false as const, error: `"${input.stop}" is an address, not a stop. Ask for departures from a station or bus stop.` };
  }

  const res = await rpGet("departureBoard", {
    id: stop.id,
    date: input.date,
    time: input.time,
    maxJourneys: Math.min(Math.max(Number(input.limit) || MAX_DEPARTURES, 1), 20),
    duration: 120,
  });
  if (isFailure(res)) return res;

  const raw = res.data.Departure;
  const list: RpDeparture[] = Array.isArray(raw) ? raw : [];
  if (!list.length) {
    return { ok: false as const, error: `No departures found from ${stop.name} in the next two hours.` };
  }

  return {
    ok: true as const,
    stop: stop.name,
    departures: list.map((dep) => {
      const cat = (dep.Product?.[0]?.catOutL || dep.name || "").toLowerCase();
      const mode = cat.includes("metro")
        ? "metro"
        : cat.includes("bus")
          ? "bus"
          : cat.includes("s-tog") || /^S\b/i.test(dep.name || "")
            ? "s-train"
            : "train";
      return {
        mode,
        line: dep.Product?.[0]?.line || dep.name || null,
        direction: dep.direction || null,
        time: hhmm(dep.time),
        liveTime: hhmm(dep.rtTime),
        platform: dep.rtTrack || dep.track || null,
        cancelled: Boolean(dep.cancelled),
      };
    }),
    source: "Rejseplanen (rejseplanen.dk)",
  };
}
