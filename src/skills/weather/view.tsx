import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Navigation,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { TOOLS } from "./meta";
import { registerToolView } from "../tool-registry";
import type { ToolViewProps } from "../tool-view";

// Shape returned by the weather skill's getWeather tool.
interface WeatherResult {
  place: string;
  now: {
    temperatureC: number;
    feelsLikeC: number;
    humidity: number;
    windKph: number;
    weatherCode: number;
    isDay: boolean;
  };
  today: { highC: number; lowC: number; weatherCode: number };
  tomorrow: { highC: number; lowC: number; weatherCode: number };
  error?: string;
}

// WMO weather code → a label + icon. Grouped per the ranges the skill documents
// (0 clear · 1–3 cloud · 45–48 fog · 51–67 rain · 71–77 snow · 80–82 showers ·
// 95–99 thunder). `isDay` only swaps the clear-sky glyph (sun vs moon).
function describeWeather(code: number, isDay: boolean): { label: string; Icon: LucideIcon } {
  if (code === 0) return { label: "Clear", Icon: isDay ? Sun : Moon };
  if (code <= 2) return { label: "Partly cloudy", Icon: CloudSun };
  if (code === 3) return { label: "Overcast", Icon: Cloud };
  if (code <= 48) return { label: "Fog", Icon: CloudFog };
  if (code <= 57) return { label: "Drizzle", Icon: CloudDrizzle };
  if (code <= 67) return { label: "Rain", Icon: CloudRain };
  if (code <= 77) return { label: "Snow", Icon: CloudSnow };
  if (code <= 82) return { label: "Showers", Icon: CloudRain };
  if (code <= 86) return { label: "Snow showers", Icon: CloudSnow };
  return { label: "Thunderstorm", Icon: CloudLightning };
}

const round = (n: number) => Math.round(n);

// A self-contained, glanceable weather card (Siri-style): place + condition
// glyph, a large current temperature, and today's high/low. Carries its own
// sky gradient (day vs night) — bespoke cards own their visual identity, unlike
// the theme-token GenericCard.
function WeatherCard({ input, result, status, surface }: ToolViewProps) {
  const data = result as WeatherResult | null;
  const requested = String((input as { location?: unknown })?.location ?? "");

  // Still running, or an error came back → a light placeholder/notice.
  if (!data || status !== "done" || data.error) {
    const text = data?.error
      ? data.error
      : `Checking the weather${requested ? ` in ${requested}` : ""}…`;
    return (
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card/80 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur">
        {text}
      </div>
    );
  }

  const { label, Icon } = describeWeather(data.now.weatherCode, data.now.isDay);
  const night = !data.now.isDay;
  const gradient = night
    ? "from-indigo-900 to-slate-800"
    : "from-sky-500 to-blue-600";

  if (surface === "notch" || surface === "overlay") {
    return (
      <div
        className={`flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br ${gradient} px-4 py-2.5 text-white shadow`}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{data.place.split(",")[0]}</div>
          <div className="text-2xl font-light leading-none">
            {round(data.now.temperatureC)}°
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <Icon className="size-6" strokeWidth={1.75} />
          <div className="text-[11px] leading-none">{label}</div>
          <div className="text-[11px] leading-none text-white/75">
            H:{round(data.today.highC)}° L:{round(data.today.lowC)}°
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`w-full max-w-sm rounded-3xl bg-gradient-to-br ${gradient} p-5 text-white shadow-lg`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-base font-semibold leading-tight">
            {data.place.split(",")[0]}
          </span>
          <Navigation className="size-3.5 -rotate-45 fill-white/90 text-white/90" />
        </div>
        <Icon className="size-9 drop-shadow" strokeWidth={1.75} />
      </div>

      <div className="mt-3 flex items-end justify-between">
        <span className="text-5xl font-light leading-none tracking-tight">
          {round(data.now.temperatureC)}°
        </span>
        <div className="text-right">
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-white/80">
            H:{round(data.today.highC)}° L:{round(data.today.lowC)}°
          </div>
        </div>
      </div>
    </div>
  );
}

registerToolView({
  name: TOOLS.getWeather,
  label: (input) => ({
    icon: "🌤️",
    label: `Check weather in ${String((input as { location?: unknown })?.location ?? "")}`,
  }),
  Card: WeatherCard,
});
