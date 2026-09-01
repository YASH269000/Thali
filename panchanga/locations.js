// Where the calculation is standing.
//
// Every date in a panchanga is local: the tithi at sunrise in Delhi can be a
// different tithi from the one at sunrise in Chennai, and that is not an error
// in either. Delhi is the default because the published all-India calendars
// this engine is checked against use it, not because it is more correct.

export const LOCATIONS = {
  delhi: { name: 'Delhi', lat: 28.6139, lon: 77.2090, tz: 5.5 },
  mumbai: { name: 'Mumbai', lat: 19.0760, lon: 72.8777, tz: 5.5 },
  kolkata: { name: 'Kolkata', lat: 22.5726, lon: 88.3639, tz: 5.5 },
  chennai: { name: 'Chennai', lat: 13.0827, lon: 80.2707, tz: 5.5 },
  bengaluru: { name: 'Bengaluru', lat: 12.9716, lon: 77.5946, tz: 5.5 },
  ahmedabad: { name: 'Ahmedabad', lat: 23.0225, lon: 72.5714, tz: 5.5 },
  varanasi: { name: 'Varanasi', lat: 25.3176, lon: 82.9739, tz: 5.5 },
  ujjain: { name: 'Ujjain', lat: 23.1765, lon: 75.7885, tz: 5.5 },
}

export const DEFAULT_LOCATION = LOCATIONS.delhi
