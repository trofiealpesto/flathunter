import { z } from "zod";

export const officeLocationSchema = z.object({
  label: z.string().trim().min(1),
  address: z.string().trim().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  district: z.string().trim().nullable(),
  provider: z.string().trim().min(1),
  updatedAt: z.string().datetime()
});

export const geoSearchResultSchema = z.object({
  label: z.string().trim().min(1),
  address: z.string().trim().min(1),
  district: z.string().trim().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  provider: z.string().trim().min(1)
});

export const listingGeoSourceSchema = z.enum(["portal_coordinates", "district_centroid"]);

type DistrictCentroid = {
  district: string;
  latitude: number;
  longitude: number;
  aliases: string[];
};

const berlinDistrictCentroids = [
  { district: "Mitte", latitude: 52.5208, longitude: 13.4095, aliases: ["mitte", "berlin mitte"] },
  {
    district: "Prenzlauer Berg",
    latitude: 52.5382,
    longitude: 13.4244,
    aliases: ["prenzlauer berg", "berlin prenzlauer berg", "prenzlberg"]
  },
  {
    district: "Friedrichshain",
    latitude: 52.5155,
    longitude: 13.4548,
    aliases: ["friedrichshain", "berlin friedrichshain", "friedrichshain kreuzberg"]
  },
  { district: "Kreuzberg", latitude: 52.4996, longitude: 13.4036, aliases: ["kreuzberg", "berlin kreuzberg"] },
  { district: "Neukolln", latitude: 52.4811, longitude: 13.4351, aliases: ["neukolln", "neukoelln", "berlin neukolln", "berlin neukoelln"] },
  { district: "Charlottenburg", latitude: 52.5046, longitude: 13.3041, aliases: ["charlottenburg", "berlin charlottenburg"] },
  {
    district: "Wilmersdorf",
    latitude: 52.4833,
    longitude: 13.3157,
    aliases: ["wilmersdorf", "berlin wilmersdorf", "charlottenburg wilmersdorf"]
  },
  { district: "Schoneberg", latitude: 52.4849, longitude: 13.3555, aliases: ["schoneberg", "schoeneberg", "berlin schoneberg", "berlin schoeneberg"] },
  { district: "Wedding", latitude: 52.5491, longitude: 13.3606, aliases: ["wedding", "berlin wedding"] },
  { district: "Moabit", latitude: 52.5302, longitude: 13.3426, aliases: ["moabit", "berlin moabit"] },
  { district: "Tempelhof", latitude: 52.4685, longitude: 13.3862, aliases: ["tempelhof", "berlin tempelhof"] },
  { district: "Steglitz", latitude: 52.4561, longitude: 13.3216, aliases: ["steglitz", "berlin steglitz"] },
  { district: "Zehlendorf", latitude: 52.4329, longitude: 13.252, aliases: ["zehlendorf", "berlin zehlendorf"] },
  { district: "Spandau", latitude: 52.536, longitude: 13.1996, aliases: ["spandau", "berlin spandau"] },
  { district: "Pankow", latitude: 52.5673, longitude: 13.4016, aliases: ["pankow", "berlin pankow"] },
  { district: "Weissensee", latitude: 52.5574, longitude: 13.4644, aliases: ["weissensee", "weißensee", "berlin weissensee", "berlin weißensee"] },
  { district: "Lichtenberg", latitude: 52.5145, longitude: 13.4986, aliases: ["lichtenberg", "berlin lichtenberg"] },
  { district: "Treptow", latitude: 52.4918, longitude: 13.4698, aliases: ["treptow", "berlin treptow", "treptow kopenick", "treptow koepenick"] },
  { district: "Kopenick", latitude: 52.4455, longitude: 13.5746, aliases: ["kopenick", "koepenick", "köpenick", "berlin kopenick", "berlin koepenick", "berlin köpenick"] },
  { district: "Reinickendorf", latitude: 52.5886, longitude: 13.3243, aliases: ["reinickendorf", "berlin reinickendorf"] },
  { district: "Marzahn", latitude: 52.545, longitude: 13.561, aliases: ["marzahn", "berlin marzahn", "marzahn hellersdorf"] },
  { district: "Hellersdorf", latitude: 52.5362, longitude: 13.6052, aliases: ["hellersdorf", "berlin hellersdorf", "marzahn hellersdorf"] }
] as const satisfies DistrictCentroid[];

function normalizeLocation(value: string | null | undefined) {
  return value
    ?.normalize("NFKD")
    .replace(/ß/g, "ss")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() ?? "";
}

export function getBerlinDistrictCentroid(value: string | null | undefined) {
  const normalized = normalizeLocation(value);

  if (!normalized) {
    return null;
  }

  for (const centroid of berlinDistrictCentroids) {
    if (centroid.aliases.some((alias) => normalized === normalizeLocation(alias) || normalized.includes(normalizeLocation(alias)))) {
      return centroid;
    }
  }

  return null;
}

export function haversineDistanceKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number }
) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRadians(right.latitude - left.latitude);
  const lonDelta = toRadians(right.longitude - left.longitude);
  const lat1 = toRadians(left.latitude);
  const lat2 = toRadians(right.latitude);

  const a =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.sin(lonDelta / 2) * Math.sin(lonDelta / 2) * Math.cos(lat1) * Math.cos(lat2);

  return Number((2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

export type OfficeLocation = z.infer<typeof officeLocationSchema>;
export type GeoSearchResult = z.infer<typeof geoSearchResultSchema>;
export type ListingGeoSource = z.infer<typeof listingGeoSourceSchema>;
