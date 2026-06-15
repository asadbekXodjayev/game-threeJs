import * as THREE from 'three';

export type PropKind = 'tree' | 'pine' | 'palm' | 'rock' | 'building' | 'cactus' | 'bush' | 'grass';

export interface Biome {
  id: string;
  name: string;
  fog: THREE.Color;
  fogDensity: number;
  sky: THREE.Color; // horizon-ish top tint used for the gradient sky
  skyLow: THREE.Color;
  sun: THREE.Color;
  ground: THREE.Color;
  groundEdge: THREE.Color; // far shoulder / terrain accent
  road: THREE.Color;
  /** scatter prop palette with relative weights */
  props: { kind: PropKind; weight: number }[];
  /** ambient life present in this biome */
  life: ('bird' | 'deer' | 'pedestrian')[];
  /** weather weighting bias (multipliers) */
  weather: Partial<Record<string, number>>;
}

const c = (hex: number) => new THREE.Color(hex);

export const BIOMES: Biome[] = [
  {
    id: 'forest',
    name: 'Pinewood Forest',
    fog: c(0x8fae8d),
    fogDensity: 0.018,
    sky: c(0x9fc4d6),
    skyLow: c(0xdbe7cf),
    sun: c(0xfff3d6),
    ground: c(0x4d6b3f),
    groundEdge: c(0x3a5230),
    road: c(0x35383c),
    props: [
      { kind: 'tree', weight: 5 },
      { kind: 'pine', weight: 4 },
      { kind: 'rock', weight: 1 },
      { kind: 'bush', weight: 3 },
      { kind: 'grass', weight: 6 },
    ],
    life: ['bird', 'deer'],
    weather: { rain: 1.4, fall: 1.6, snow: 0.4, storm: 0.8 },
  },
  {
    id: 'mountains',
    name: 'Alpine Pass',
    fog: c(0xa9b6c2),
    fogDensity: 0.022,
    sky: c(0x7d9fc4),
    skyLow: c(0xc6d3df),
    sun: c(0xeef2ff),
    ground: c(0x6c6f63),
    groundEdge: c(0x53564d),
    road: c(0x3a3d42),
    props: [
      { kind: 'pine', weight: 5 },
      { kind: 'rock', weight: 4 },
      { kind: 'tree', weight: 1 },
      { kind: 'bush', weight: 2 },
      { kind: 'grass', weight: 4 },
    ],
    life: ['bird', 'deer'],
    weather: { snow: 2.2, storm: 1.2, rain: 0.7, fall: 0.4 },
  },
  {
    id: 'beach',
    name: 'Coast Highway',
    fog: c(0xbfe0e4),
    fogDensity: 0.014,
    sky: c(0x6fc6dd),
    skyLow: c(0xffe6bf),
    sun: c(0xffd79a),
    ground: c(0xcdb98a),
    groundEdge: c(0x4a8fa6),
    road: c(0x3c3f44),
    props: [
      { kind: 'palm', weight: 6 },
      { kind: 'rock', weight: 2 },
      { kind: 'grass', weight: 5 },
      { kind: 'bush', weight: 2 },
    ],
    life: ['bird', 'pedestrian'],
    weather: { storm: 1.8, rain: 1.2, fall: 0.3, snow: 0.05 },
  },
  {
    id: 'city',
    name: 'Neon Downtown',
    fog: c(0x6b7585),
    fogDensity: 0.02,
    sky: c(0x586985),
    skyLow: c(0x9aa6bb),
    sun: c(0xffe9cf),
    ground: c(0x3b3f47),
    groundEdge: c(0x2c3038),
    road: c(0x2f3237),
    props: [
      { kind: 'building', weight: 7 },
      { kind: 'tree', weight: 2 },
      { kind: 'bush', weight: 2 },
      { kind: 'grass', weight: 2 },
    ],
    life: ['bird', 'pedestrian'],
    weather: { rain: 1.6, storm: 1.1, fall: 0.6, snow: 0.6 },
  },
];

export const BIOME_SECONDS = 60; // time per biome
export const TRANSITION_SECONDS = 9; // cross-fade corridor (>= 8s gate)
