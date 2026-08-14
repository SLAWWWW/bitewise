// Demo-only proxy for geocoding: the public donation form has donors pick a
// general area instead of typing coordinates. Server-side code resolves the
// same list to a lat/lng centroid, so this file must stay the single source
// of truth for both the form dropdown and the matching algorithm's input.
export const SG_AREAS = [
  { value: 'woodlands', label: 'Woodlands', lat: 1.4382, lng: 103.7891 },
  { value: 'yishun', label: 'Yishun', lat: 1.4304, lng: 103.8354 },
  { value: 'toa_payoh', label: 'Toa Payoh', lat: 1.3343, lng: 103.8563 },
  { value: 'bukit_merah', label: 'Bukit Merah', lat: 1.2819, lng: 103.8239 },
  { value: 'tampines', label: 'Tampines', lat: 1.3496, lng: 103.9568 },
  { value: 'orchard', label: 'Orchard / Central', lat: 1.3048, lng: 103.8318 },
  { value: 'jurong_east', label: 'Jurong East', lat: 1.3329, lng: 103.7436 },
  { value: 'bedok', label: 'Bedok', lat: 1.3236, lng: 103.9273 },
  { value: 'ang_mo_kio', label: 'Ang Mo Kio', lat: 1.3691, lng: 103.8454 },
  { value: 'punggol', label: 'Punggol', lat: 1.4043, lng: 103.9022 },
  { value: 'changi', label: 'Changi', lat: 1.3644, lng: 103.9915 },
  { value: 'clementi', label: 'Clementi', lat: 1.3162, lng: 103.7649 },
] as const;

export type AreaValue = (typeof SG_AREAS)[number]['value'];

export const DONOR_TYPES = ['supermarket', 'hotel', 'restaurant', 'factory', 'other'] as const;

// Unclaimed inventory this close to spoiling stops waiting on public claims
// and is routed to Willing Hearts' known/partner beneficiaries instead —
// matching how the org actually distributes (direct delivery to registered
// households), rather than leaving it to expire unclaimed on the public app.
export const ESCALATION_THRESHOLD_HOURS = 3;
