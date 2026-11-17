# Eyes on the Street: Morningside Heights

**Prototype after the final project** ([Frostroot: Whiteout](../20261116_final/)). Spatial AI, Columbia GSAPP. Ryan Fu, Lu Liu, Yifan Zhao.

**Live:** https://yz5149-stack.github.io/spatial_ai_gsapp/20261117_eyes/

How many people can see each spot of Morningside Heights, hour by hour? The game's creature is replaced by ordinary night walkers, whose numbers come from the real hourly counts of the 116 St–Columbia University subway station. Street lights decide how far they can see and which streets they avoid. Add lights or a late-night shop and compare with the baseline.

**It measures natural surveillance (Jane Jacobs' "eyes on the street", CPTED), not crime.** It uses no crime data on purpose: crime has causes street geometry does not hold, and police data records where police look as much as where crime happens.

## Data

| What | Source | Real or assumed |
|---|---|---|
| Streets, paths, buildings (surveyed heights), terrain | OpenStreetMap; NYC Building Footprints (from the final project, `../20261116_final/data/morningside.json`) | real |
| People entering the station, per hour | MTA Subway Hourly Ridership: Beginning 2025 (data.ny.gov `5wq4-mkjj`), station 307, October 2025, mean per day type | real |
| People leaving the station, per hour | MTA Subway Origin-Destination Ridership Estimate: 2025 (data.ny.gov `y2qv-fytt`), October 2025 | real (MTA estimate) |
| Street lights out | NYC 311 Service Requests (`erm2-nwe9`), "Street Light Condition", last 12 months, inside the map | real |
| Street light positions | NYC does not publish them: one pole every 30 m along every avenue and street; optionally every 45 m along campus and park paths; OSM lamps | **modelled** |
| Other walkers (not subway riders) | a multiple of the riders, set with a slider (default 1.5) | **assumed** |
| Shop hours | OSM shops open 7:00–22:00; a late-night shop you add, 7:00–2:00 | **assumed** |
| Sight | 30 m in light, 10 m in the dark; buildings and trees block it | **assumed** |

## Model

- **Walkers**: each hour, station exits walk to buildings (weighted by floor area) or out of the map; station entries walk from them; other walkers go between buildings, shops and the map's edges. Everyone takes the cheapest route; at night dark cells cost more ("how much people avoid the dark").
- **Eyes on a spot**: the expected number of people who can see it at a random moment of the hour, plus shopkeepers while open.
- **Measures**: share of open ground *watched* (≥ ½ person's eyes), *dark and unwatched* at night (light < 35 % and not watched), share of *walking time unseen* by anyone else, and how much longer night walks are because people avoid the dark. A table ranks streets from least watched.

## Files

`index.html`, `style.css`; `src/eyes.js` (the model, no DOM), `src/ui.js` (the page); `data/morningside-eyes.json` (made by `tools/fetch_eyes.mjs`; `npm run fetch-data`); `tests/` (`npm test`).
