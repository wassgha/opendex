import { z } from "zod";
import { meta, TOOLS } from "./meta";
import type { Skill } from "../types";

// Weather — read-only, always on. Uses Open-Meteo (no API key required).
export const weatherSkill: Skill = {
  ...meta,
  tools: [
    {
      name: TOOLS.getWeather,
      description:
        "Get the current weather and a brief forecast for a given location (city name or place). Uses Open-Meteo (no API key required).",
      inputSchema: z.object({
        location: z
          .string()
          .describe("City name or place, e.g. 'London' or 'Tokyo'."),
      }),
      execute: async ({ location }: { location: string }) => {
        const geo = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
        ).then(
          (r) =>
            r.json() as Promise<{
              results?: Array<{
                latitude: number;
                longitude: number;
                name: string;
                country: string;
                timezone: string;
              }>;
            }>,
        );

        const place = geo.results?.[0];
        if (!place) return { error: `I couldn't find a place called "${location}".` };

        const forecast = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2`,
        ).then(
          (r) =>
            r.json() as Promise<{
              current: Record<string, number>;
              daily: {
                weather_code: number[];
                temperature_2m_max: number[];
                temperature_2m_min: number[];
              };
            }>,
        );

        return {
          place: `${place.name}, ${place.country}`,
          now: {
            temperatureC: forecast.current.temperature_2m,
            feelsLikeC: forecast.current.apparent_temperature,
            humidity: forecast.current.relative_humidity_2m,
            windKph: forecast.current.wind_speed_10m,
            weatherCode: forecast.current.weather_code,
            isDay: forecast.current.is_day === 1,
          },
          today: {
            highC: forecast.daily.temperature_2m_max[0],
            lowC: forecast.daily.temperature_2m_min[0],
            weatherCode: forecast.daily.weather_code[0],
          },
          tomorrow: {
            highC: forecast.daily.temperature_2m_max[1],
            lowC: forecast.daily.temperature_2m_min[1],
            weatherCode: forecast.daily.weather_code[1],
          },
          note: "weather_code follows WMO codes (0=clear, 1-3=mainly clear/partly/overcast, 45-48=fog, 51-67=drizzle/rain, 71-77=snow, 80-82=showers, 95-99=thunderstorm).",
        };
      },
    },
  ],
};
