export type WeatherId = 'clear' | 'rain' | 'storm' | 'snow' | 'fall' | 'tornado';

export interface WeatherDef {
  id: WeatherId;
  label: string;
  particle: 'none' | 'rain' | 'snow' | 'leaf';
  /** fog density multiplier applied over the biome value */
  fogMul: number;
  /** sky/light darkening 0..1 (0 = no change) */
  dark: number;
  /** sun intensity multiplier */
  sunMul: number;
  lightning: boolean;
  /** distant cinematic tornado funnel */
  tornado?: boolean;
  /** base particle count at high quality */
  count: number;
  baseWeight: number; // scheduling weight before biome bias
}

export const WEATHERS: Record<WeatherId, WeatherDef> = {
  clear: { id: 'clear', label: 'Clear', particle: 'none', fogMul: 1, dark: 0, sunMul: 1, lightning: false, count: 0, baseWeight: 0 },
  rain: { id: 'rain', label: 'Rain', particle: 'rain', fogMul: 1.5, dark: 0.4, sunMul: 0.55, lightning: false, count: 4500, baseWeight: 1 },
  storm: { id: 'storm', label: 'Storm', particle: 'rain', fogMul: 1.9, dark: 0.62, sunMul: 0.35, lightning: true, count: 6000, baseWeight: 0.7 },
  snow: { id: 'snow', label: 'Snow', particle: 'snow', fogMul: 1.7, dark: 0.28, sunMul: 0.7, lightning: false, count: 3500, baseWeight: 0.9 },
  fall: { id: 'fall', label: 'Falling Leaves', particle: 'leaf', fogMul: 1.15, dark: 0.12, sunMul: 0.9, lightning: false, count: 900, baseWeight: 0.8 },
  tornado: { id: 'tornado', label: 'Distant Tornado', particle: 'none', fogMul: 1.4, dark: 0.5, sunMul: 0.4, lightning: false, tornado: true, count: 1400, baseWeight: 0.28 },
};

export const WEATHER_EVENT_IDS: WeatherId[] = ['rain', 'storm', 'snow', 'fall', 'tornado'];
