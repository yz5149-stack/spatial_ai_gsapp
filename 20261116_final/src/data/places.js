// The real places the simulation can be set in, and the real storm.
// Each place is about 640 m by 480 m. bbox in WGS84 degrees; center = [lon, lat].

export const STORM = {
  name: 'The January 2016 blizzard (Winter Storm Jonas)',
  start: '2016-01-22',
  end: '2016-01-24',
  // the night that is played: hourly, local time (America/New_York)
  nightStart: '2016-01-22T21:00',
  hours: 12,
};

export const PLACES = [
  {
    id: 'morningside',
    name: 'Morningside Heights',
    blurb: 'Columbia, Broadway to Morningside Park. Tall institutional blocks and a 30 m cliff down to Harlem.',
    center: [-73.9617, 40.8060],
    bbox: { west: -73.9655, east: -73.9579, south: 40.80385, north: 40.80815 },
    refuge: { kind: 'hospital', name: 'Mount Sinai Morningside' },
  },
  {
    id: 'ramble',
    name: 'Central Park, The Ramble',
    blurb: 'Woods, winding paths and the Lake, between Central Park West and the Bow Bridge.',
    center: [-73.9700, 40.77895],
    bbox: { west: -73.9738, east: -73.9662, south: 40.7768, north: 40.7811 },
    refuge: { kind: 'subway', name: '81 St–Museum of Natural History' },
  },
  {
    id: 'fidi',
    name: 'Lower Manhattan',
    blurb: 'The crooked colonial streets of the Financial District between skyscrapers, by the hospital on William Street.',
    center: [-74.0070, 40.7093],
    bbox: { west: -74.0108, east: -74.0032, south: 40.70715, north: 40.71145 },
    refuge: { kind: 'hospital', name: 'NewYork-Presbyterian Lower Manhattan Hospital' },
  },
];
