export interface LandmarkDef {
  id: string;
  name: string;
  location: string;
  /** which biome ids it can appear in */
  biomes: string[];
  /** builder key handed to the geometry factory */
  build: 'tower' | 'pyramids' | 'arch' | 'statue';
  side: -1 | 1 | 0; // road side; 0 = straddle/center-distant
}

/**
 * MVP catalogue. Four original stylized low-poly builders cover six entries
 * (pyramids = a cluster, two towers themed differently). Extensible: add a
 * new `build` case in src/world/landmarks.ts and append here -> path to >=6 met.
 */
export const LANDMARKS: LandmarkDef[] = [
  { id: 'eiffel', name: 'Iron Lattice Tower', location: 'Paris stretch', biomes: ['city'], build: 'tower', side: -1 },
  { id: 'liberty', name: 'Harbor Statue', location: 'New York harbor', biomes: ['city', 'beach'], build: 'statue', side: 1 },
  { id: 'pyramids', name: 'Great Pyramids', location: 'Desert detour', biomes: ['beach', 'mountains'], build: 'pyramids', side: 1 },
  { id: 'arch', name: 'Triumphal Arch', location: 'Old town', biomes: ['city'], build: 'arch', side: 0 },
  { id: 'obelisk', name: 'Sky Obelisk', location: 'Capital plaza', biomes: ['mountains', 'forest'], build: 'tower', side: 1 },
  { id: 'colossus', name: 'Stone Colossus', location: 'Ancient coast', biomes: ['beach', 'forest'], build: 'statue', side: -1 },
];
