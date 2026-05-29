import { tool } from "ai";
import { z } from "zod";

const getCurrentTime = tool({
  description:
    "Get the current date and time. Optionally pass an IANA timezone (e.g. 'Europe/London', 'America/New_York'). Defaults to UTC.",
  inputSchema: z.object({
    timezone: z
      .string()
      .optional()
      .describe("IANA timezone, e.g. 'Europe/London'. Defaults to UTC."),
  }),
  execute: async ({ timezone }) => {
    const tz = timezone ?? "UTC";
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(now);
      return { timezone: tz, formatted, iso: now.toISOString() };
    } catch {
      return { error: `Unknown timezone: ${tz}` };
    }
  },
});

const getWeather = tool({
  description:
    "Get the current weather and a brief forecast for a given location (city name or place). Uses Open-Meteo (no API key required).",
  inputSchema: z.object({
    location: z.string().describe("City name or place, e.g. 'London' or 'Tokyo'."),
  }),
  execute: async ({ location }) => {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`,
    ).then((r) => r.json() as Promise<{ results?: Array<{ latitude: number; longitude: number; name: string; country: string; timezone: string }> }>);

    const place = geo.results?.[0];
    if (!place) return { error: `I couldn't find a place called "${location}".` };

    const forecast = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2`,
    ).then((r) => r.json() as Promise<{
      current: Record<string, number>;
      daily: { weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
    }>);

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
});

const webSearch = tool({
  description:
    "Search the live web for current information, news, facts, or anything that may have changed since training. Returns a list of relevant results with titles, URLs, and snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query."),
  }),
  execute: async ({ query }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        error:
          "Web search is unavailable — the operator has not configured a TAVILY_API_KEY.",
      };
    }
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: true,
      }),
    });
    if (!res.ok) {
      return { error: `Search failed: ${res.status} ${res.statusText}` };
    }
    const data = (await res.json()) as {
      answer?: string;
      results: Array<{ title: string; url: string; content: string }>;
    };
    return {
      answer: data.answer,
      results: data.results.slice(0, 5).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content.slice(0, 400),
      })),
    };
  },
});

export const tools = {
  getCurrentTime,
  getWeather,
  webSearch,
} as const;

export type JarvisTools = typeof tools;
