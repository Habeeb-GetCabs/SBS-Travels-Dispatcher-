// Source: Google Maps Platform Code Assist
// Google Places API (New) & Routes API Integration for SBS Travels Dispatch
// Provides live real-time autocomplete suggestions with session tokens and driving route estimations

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullAddress: string;
  latitude?: number;
  longitude?: number;
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
}

export interface RouteEstimationResult {
  distanceKm: number;
  durationMinutes: number;
  status: 'ROUTES_API_SUCCESS' | 'GEODETIC_CALCULATED' | 'FALLBACK';
}

export const getStoredGoogleMapsKey = (): string => {
  return (
    (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ||
    localStorage.getItem('sbs_google_maps_key') ||
    ''
  );
};

export const setStoredGoogleMapsKey = (key: string): void => {
  if (key) {
    localStorage.setItem('sbs_google_maps_key', key.trim());
  } else {
    localStorage.removeItem('sbs_google_maps_key');
  }
};

// Known landmark database for immediate offline/fallback autocomplete (Coimbatore Base)
const COMMON_LANDMARKS: PlaceSuggestion[] = [
  {
    placeId: 'ChIJ_yWJ1MhpqDsR0Hk9V7Q4e7M',
    primaryText: 'Coimbatore International Airport (CJB)',
    secondaryText: 'Avinashi Road, Peelamedu, Coimbatore, Tamil Nadu',
    fullAddress: 'Avinashi Rd, Peelamedu, Coimbatore, Tamil Nadu 641014',
    latitude: 11.0300,
    longitude: 77.0434,
  },
  {
    placeId: 'ChIJ6a6c4F1nUjoR_M4Q4Vf18eY_cbe',
    primaryText: 'Coimbatore Junction Railway Station (CBE)',
    secondaryText: 'State Bank Road, Gopalapuram, Coimbatore, Tamil Nadu',
    fullAddress: 'State Bank Rd, Gopalapuram, Coimbatore, Tamil Nadu 641018',
    latitude: 11.0018,
    longitude: 76.9629,
  },
  {
    placeId: 'ChIJQ-s4HnBnUjoR1fG86w0Z9_gandhi',
    primaryText: 'Gandhipuram Town Bus Stand',
    secondaryText: 'Cross Cut Road, Gandhipuram, Coimbatore, Tamil Nadu',
    fullAddress: 'Cross Cut Rd, Gandhipuram, Coimbatore, Tamil Nadu 641012',
    latitude: 11.0168,
    longitude: 76.9558,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_tidel',
    primaryText: 'TIDEL Park Coimbatore (ELCOSEZ / PSG Tech)',
    secondaryText: 'Civil Aerodrome Post, Peelamedu, Coimbatore, Tamil Nadu',
    fullAddress: 'Avinashi Rd, Peelamedu, Coimbatore, Tamil Nadu 641014',
    latitude: 11.0264,
    longitude: 77.0270,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_ukkadam',
    primaryText: 'Ukkadam Bus Stand',
    secondaryText: 'Palakkad Road, Ukkadam, Coimbatore, Tamil Nadu',
    fullAddress: 'Palakkad Rd, Ukkadam, Coimbatore, Tamil Nadu 641001',
    latitude: 10.9902,
    longitude: 76.9602,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_rspuram',
    primaryText: 'RS Puram DB Road',
    secondaryText: 'Diwan Bahadur Road, RS Puram, Coimbatore, Tamil Nadu',
    fullAddress: 'DB Rd, RS Puram, Coimbatore, Tamil Nadu 641002',
    latitude: 11.0095,
    longitude: 76.9452,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_singanallur',
    primaryText: 'Singanallur Bus Stand',
    secondaryText: 'Trichy Road, Singanallur, Coimbatore, Tamil Nadu',
    fullAddress: 'Trichy Rd, Singanallur, Coimbatore, Tamil Nadu 641005',
    latitude: 10.9982,
    longitude: 77.0245,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_saravanampatti',
    primaryText: 'Saravanampatti IT Hub (CHIL SEZ / Prozone Mall)',
    secondaryText: 'Sathy Road, Saravanampatti, Coimbatore, Tamil Nadu',
    fullAddress: 'Sathy Rd, Saravanampatti, Coimbatore, Tamil Nadu 641035',
    latitude: 11.0784,
    longitude: 76.9926,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_brooks',
    primaryText: 'Brookefields Mall',
    secondaryText: 'Krishnaswamy Road, Ram Nagar, Coimbatore, Tamil Nadu',
    fullAddress: '678, Krishnaswamy Rd, Ram Nagar, Coimbatore, Tamil Nadu 641001',
    latitude: 11.0118,
    longitude: 76.9585,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_marudhamalai',
    primaryText: 'Marudhamalai Murugan Temple',
    secondaryText: 'Marudhamalai Adivaram, Coimbatore, Tamil Nadu',
    fullAddress: 'Marudhamalai, Coimbatore, Tamil Nadu 641046',
    latitude: 11.0470,
    longitude: 76.8520,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_sulur',
    primaryText: 'Sulur Bus Stand / Air Force Station',
    secondaryText: 'Trichy Road, Sulur, Coimbatore, Tamil Nadu',
    fullAddress: 'Trichy Rd, Sulur, Coimbatore, Tamil Nadu 641402',
    latitude: 11.0268,
    longitude: 77.1264,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_thudiyalur',
    primaryText: 'Thudiyalur Junction',
    secondaryText: 'Mettupalayam Road, Thudiyalur, Coimbatore, Tamil Nadu',
    fullAddress: 'Mettupalayam Rd, Thudiyalur, Coimbatore, Tamil Nadu 641034',
    latitude: 11.0825,
    longitude: 76.9421,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE_kovaipudur',
    primaryText: 'Kovaipudur VLB College Junction',
    secondaryText: 'Kovaipudur, Coimbatore, Tamil Nadu',
    fullAddress: 'Kovaipudur, Coimbatore, Tamil Nadu 641042',
    latitude: 10.9385,
    longitude: 76.9325,
  },
];

// Load Google Maps JS SDK dynamically to support native browser Places/Routes API calls
let sdkPromise: Promise<any> | null = null;
let currentLoadedKey = '';

export const loadGoogleMapsSDK = async (key: string): Promise<any> => {
  if (!key) return null;
  if ((window as any).google?.maps?.places && currentLoadedKey === key) {
    return (window as any).google;
  }
  if (sdkPromise && currentLoadedKey === key) {
    return sdkPromise;
  }

  currentLoadedKey = key;
  sdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('gmaps-js-sdk');
    if (existingScript) {
      existingScript.remove();
    }
    const script = document.createElement('script');
    script.id = 'gmaps-js-sdk';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places,routes,geometry&v=weekly`;
    script.async = true;
    script.onload = () => {
      if ((window as any).google?.maps) {
        resolve((window as any).google);
      } else {
        reject(new Error('Google Maps SDK loaded but google.maps missing'));
      }
    };
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });

  return sdkPromise;
};

// Generate UUID v4 for Google Places session token
export const createPlacesSessionToken = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Helper for strict Promise timeout
const withTimeout = <T>(promise: Promise<T>, ms = 1200): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Maps API Timeout')), ms)),
  ]);
};

// Autocomplete using Google Places API & JS SDK AutocompleteService (Coimbatore Biased)
export const fetchPlacePredictions = async (
  input: string,
  sessionToken: string
): Promise<PlaceSuggestion[]> => {
  const query = input.trim();
  if (query.length < 1) return [];

  const key = getStoredGoogleMapsKey();
  if (key) {
    // Attempt 1: Standard Google Maps JS SDK AutocompleteService (With 1.0s timeout)
    try {
      const google = await withTimeout(loadGoogleMapsSDK(key), 1000);
      if (google?.maps?.places?.AutocompleteService) {
        const autoService = new google.maps.places.AutocompleteService();
        const predictions = await withTimeout(
          new Promise<any[]>((resolve) => {
            autoService.getPlacePredictions(
              {
                input: query,
                componentRestrictions: { country: 'in' },
                locationBias: new google.maps.LatLngBounds(
                  new google.maps.LatLng(10.8, 76.8), // Coimbatore S/W
                  new google.maps.LatLng(11.3, 77.3)  // Coimbatore N/E
                ),
              },
              (results: any[], status: any) => {
                if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                  resolve(results);
                } else {
                  resolve([]);
                }
              }
            );
          }),
          1200
        );

        if (predictions && predictions.length > 0) {
          return predictions.map((p) => ({
            placeId: p.place_id,
            primaryText: p.structured_formatting?.main_text || p.description,
            secondaryText: p.structured_formatting?.secondary_text || '',
            fullAddress: p.description,
          }));
        }
      }
    } catch (sdkErr) {
      console.warn('Google Maps AutocompleteService notice:', sdkErr);
    }

    // Attempt 2: Server proxy endpoint
    try {
      const response = await withTimeout(
        fetch('/api/gmaps/places/v1/places:autocomplete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
          },
          body: JSON.stringify({
            input: query,
            sessionToken: sessionToken,
            includedRegionCodes: ['in'],
            locationBias: {
              circle: {
                center: { latitude: 11.0168, longitude: 76.9558 },
                radius: 50000.0,
              },
            },
          }),
        }),
        1200
      );

      if (response.ok) {
        const data = await response.json();
        if (data.suggestions && Array.isArray(data.suggestions)) {
          return data.suggestions.map((s: any) => {
            const pred = s.placePrediction;
            return {
              placeId: pred.placeId,
              primaryText: pred.structuredFormat?.mainText?.text || pred.text?.text || query,
              secondaryText: pred.structuredFormat?.secondaryText?.text || '',
              fullAddress: pred.text?.text || pred.structuredFormat?.mainText?.text || query,
            };
          });
        }
      }
    } catch (err) {
      console.warn('Google Places Proxy attempt notice:', err);
    }
  }

  // Matching from Coimbatore landmark database as fallback
  const lower = query.toLowerCase();
  const matched = COMMON_LANDMARKS.filter(
    (l) =>
      l.primaryText.toLowerCase().includes(lower) ||
      l.secondaryText.toLowerCase().includes(lower) ||
      l.fullAddress.toLowerCase().includes(lower)
  );

  const results = [...matched];
  if (!results.some((r) => r.primaryText.toLowerCase() === lower)) {
    results.unshift({
      placeId: `custom-${Date.now()}`,
      primaryText: `${query}, Coimbatore`,
      secondaryText: 'Coimbatore Location',
      fullAddress: `${query}, Coimbatore, Tamil Nadu, India`,
      latitude: 11.0168,
      longitude: 76.9558,
    });
  }

  return results;
};

// Fetch Place Details (New Places API)
export const fetchPlaceDetails = async (
  placeId: string,
  sessionToken?: string
): Promise<PlaceDetails | null> => {
  // Check landmarks cache first
  const cached = COMMON_LANDMARKS.find((l) => l.placeId === placeId);
  if (cached && cached.latitude && cached.longitude) {
    return {
      placeId: cached.placeId,
      name: cached.primaryText,
      formattedAddress: cached.fullAddress,
      latitude: cached.latitude,
      longitude: cached.longitude,
    };
  }

  const key = getStoredGoogleMapsKey();
  if (key && !placeId.startsWith('custom-')) {
    // Attempt 1: Server proxy
    try {
      const response = await fetch(
        `/api/gmaps/places/v1/places/${placeId}?fields=id,displayName,formattedAddress,location&key=${key}`,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(sessionToken ? { 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location' } : {}),
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        return {
          placeId: data.id || placeId,
          name: data.displayName?.text || '',
          formattedAddress: data.formattedAddress || '',
          latitude: data.location?.latitude || 0,
          longitude: data.location?.longitude || 0,
        };
      }
    } catch (err) {
      console.warn('Google Place Details Proxy notice:', err);
    }

    // Attempt 2: Direct REST
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}?fields=id,displayName,formattedAddress,location&key=${key}`,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(sessionToken ? { 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location' } : {}),
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        return {
          placeId: data.id || placeId,
          name: data.displayName?.text || '',
          formattedAddress: data.formattedAddress || '',
          latitude: data.location?.latitude || 0,
          longitude: data.location?.longitude || 0,
        };
      }
    } catch (err) {
      console.warn('Direct Google Place Details REST notice:', err);
    }

    // Attempt 3: JS SDK Geocoder & Place class
    try {
      const google = await loadGoogleMapsSDK(key);
      if (google?.maps?.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        const geoResult = await new Promise<any>((resolve) => {
          geocoder.geocode({ placeId }, (results: any[], status: any) => {
            if (status === 'OK' && results && results[0]) {
              resolve(results[0]);
            } else {
              resolve(null);
            }
          });
        });

        if (geoResult) {
          return {
            placeId,
            name: geoResult.formatted_address?.split(',')[0] || placeId,
            formattedAddress: geoResult.formatted_address || '',
            latitude: geoResult.geometry.location.lat(),
            longitude: geoResult.geometry.location.lng(),
          };
        }
      }

      if (google?.maps?.places) {
        const placesLib = (await google.maps.importLibrary('places')) as any;
        if (placesLib?.Place) {
          const place = new placesLib.Place({ id: placeId });
          await place.fetchFields({
            fields: ['displayName', 'formattedAddress', 'location'],
          });
          return {
            placeId: place.id || placeId,
            name: place.displayName || '',
            formattedAddress: place.formattedAddress || '',
            latitude: place.location?.lat() || 0,
            longitude: place.location?.lng() || 0,
          };
        }
      }
    } catch (sdkErr) {
      console.warn('Google Maps JS SDK Place Details notice:', sdkErr);
    }
  }

  return null;
};

// Calculate driving distance & duration via Google Routes API
export const calculateDrivingRoute = async (
  origin: { latitude?: number; longitude?: number; address?: string },
  destination: { latitude?: number; longitude?: number; address?: string }
): Promise<RouteEstimationResult> => {
  const key = getStoredGoogleMapsKey();
  if (
    key &&
    origin.latitude &&
    origin.longitude &&
    destination.latitude &&
    destination.longitude
  ) {
    const requestBody = JSON.stringify({
      origin: {
        location: {
          latLng: {
            latitude: origin.latitude,
            longitude: origin.longitude,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    });

    // Attempt 1: Server proxy
    try {
      const response = await fetch('/api/gmaps/routes/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: requestBody,
      });

      if (response.ok) {
        const data = await response.json();
        const route = data.routes?.[0];
        if (route) {
          const meters = route.distanceMeters || 0;
          const durationStr = route.duration || '0s';
          const seconds = parseInt(durationStr.replace('s', ''), 10) || 0;

          return {
            distanceKm: Number((meters / 1000).toFixed(1)),
            durationMinutes: Math.ceil(seconds / 60),
            status: 'ROUTES_API_SUCCESS',
          };
        }
      }
    } catch (err) {
      console.warn('Routes API Proxy computeRoutes notice:', err);
    }

    // Attempt 2: Direct REST
    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: requestBody,
      });

      if (response.ok) {
        const data = await response.json();
        const route = data.routes?.[0];
        if (route) {
          const meters = route.distanceMeters || 0;
          const durationStr = route.duration || '0s';
          const seconds = parseInt(durationStr.replace('s', ''), 10) || 0;

          return {
            distanceKm: Number((meters / 1000).toFixed(1)),
            durationMinutes: Math.ceil(seconds / 60),
            status: 'ROUTES_API_SUCCESS',
          };
        }
      }
    } catch (err) {
      console.warn('Direct Routes API computeRoutes notice:', err);
    }
  }

  // Fallback based on Haversine distance * road tortuosity factor (~1.28)
  if (
    origin.latitude &&
    origin.longitude &&
    destination.latitude &&
    destination.longitude
  ) {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(destination.latitude - origin.latitude);
    const dLon = toRad(destination.longitude - origin.longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(origin.latitude)) *
        Math.cos(toRad(destination.latitude)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightKm = R * c;

    const estimatedRoadKm = Number((straightKm * 1.28).toFixed(1));
    const estimatedMinutes = Math.max(10, Math.round(estimatedRoadKm * 2.1));

    return {
      distanceKm: estimatedRoadKm,
      durationMinutes: estimatedMinutes,
      status: 'GEODETIC_CALCULATED',
    };
  }

  return {
    distanceKm: 25.0,
    durationMinutes: 45,
    status: 'FALLBACK',
  };
};
