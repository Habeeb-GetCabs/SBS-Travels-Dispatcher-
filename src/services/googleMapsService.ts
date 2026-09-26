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

// Known landmark database for immediate offline/fallback autocomplete
const COMMON_LANDMARKS: PlaceSuggestion[] = [
  {
    placeId: 'ChIJ574W5uNnUjoR-K8u5Z3P_Z0',
    primaryText: 'Chennai International Airport (MAA)',
    secondaryText: 'Meenambakkam, Chennai, Tamil Nadu',
    fullAddress: 'GST Rd, Meenambakkam, Chennai, Tamil Nadu 600027',
    latitude: 12.9941,
    longitude: 80.1709,
  },
  {
    placeId: 'ChIJS_b8uI1nUjoRqQ3V7gKvZ98',
    primaryText: 'Puratchi Thalaivar Dr. M.G.R. Central Railway Station',
    secondaryText: 'Kannappar Thidal, Periyamet, Chennai',
    fullAddress: 'Kannappar Thidal, Periyamet, Chennai, Tamil Nadu 600003',
    latitude: 13.0827,
    longitude: 80.2707,
  },
  {
    placeId: 'ChIJQ-s4HnBnUjoR1fG86w0Z9_0',
    primaryText: 'T. Nagar Panagal Park',
    secondaryText: 'Thyagaraya Nagar, Chennai, Tamil Nadu',
    fullAddress: 'Prakasam Rd, Panagal Park, T. Nagar, Chennai, Tamil Nadu 600017',
    latitude: 13.0405,
    longitude: 80.2337,
  },
  {
    placeId: 'ChIJv8v86hhnUjoRsM8P39g89eE',
    primaryText: 'OMR IT Corridor (Tidel Park)',
    secondaryText: 'Rajiv Gandhi Salai, Taramani, Chennai',
    fullAddress: 'No.4, Rajiv Gandhi Salai, Taramani, Chennai, Tamil Nadu 600113',
    latitude: 12.9892,
    longitude: 80.2476,
  },
  {
    placeId: 'ChIJ6a6c4F1nUjoR_M4Q4Vf18eY',
    primaryText: 'Chennai Mofussil Bus Terminus (CMBT)',
    secondaryText: 'Koyambedu, Chennai, Tamil Nadu',
    fullAddress: 'Jawaharlal Nehru Rd, Koyambedu, Chennai, Tamil Nadu 600107',
    latitude: 13.0694,
    longitude: 80.2057,
  },
  {
    placeId: 'ChIJvX_Fv7dmUjoR2W3d1k6V-1U',
    primaryText: 'SIPCOT IT Park Siruseri',
    secondaryText: 'Old Mahabalipuram Rd, Siruseri, Tamil Nadu',
    fullAddress: 'OMR, Siruseri, Tamil Nadu 603103',
    latitude: 12.8256,
    longitude: 80.2209,
  },
  {
    placeId: 'ChIJ_Q868sBoUjoRNr88V90a5-A',
    primaryText: 'Mahabalipuram Shore Temple',
    secondaryText: 'Mamallapuram, Tamil Nadu',
    fullAddress: 'Fisherman Colony, Mahabalipuram, Tamil Nadu 603104',
    latitude: 12.6163,
    longitude: 80.1983,
  },
  {
    placeId: 'ChIJh982j4BlUjoRgM4Z9W1Y-54',
    primaryText: 'Tambaram Railway Station',
    secondaryText: 'East Tambaram, Chennai, Tamil Nadu',
    fullAddress: 'Grand Southern Trunk Rd, Tambaram, Chennai, Tamil Nadu 600045',
    latitude: 12.9249,
    longitude: 80.1287,
  }
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

// Autocomplete using Google Places API (New) - Bypasses CORS via Proxy and JS SDK
export const fetchPlacePredictions = async (
  input: string,
  sessionToken: string
): Promise<PlaceSuggestion[]> => {
  const query = input.trim();
  if (query.length < 2) return [];

  const key = getStoredGoogleMapsKey();
  if (key) {
    // Attempt 1: Server proxy (bypasses browser CORS preflight restrictions)
    try {
      const response = await fetch('/api/gmaps/places/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
        },
        body: JSON.stringify({
          input: query,
          sessionToken: sessionToken,
          includedRegionCodes: ['in'],
        }),
      });

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

    // Attempt 2: Direct Google Places REST Endpoint
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
        },
        body: JSON.stringify({
          input: query,
          sessionToken: sessionToken,
          includedRegionCodes: ['in'],
        }),
      });

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
      console.warn('Direct Google Places REST notice:', err);
    }

    // Attempt 3: Google Maps JS SDK (if loaded)
    try {
      const google = await loadGoogleMapsSDK(key);
      if (google?.maps?.places) {
        const placesLib = (await google.maps.importLibrary('places')) as any;
        if (placesLib?.AutocompleteSuggestion) {
          const res = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            sessionToken: sessionToken ? new google.maps.places.AutocompleteSessionToken() : undefined,
            includedRegionCodes: ['in'],
          });
          if (res?.suggestions && res.suggestions.length > 0) {
            return res.suggestions.map((s: any) => {
              const pred = s.placePrediction;
              return {
                placeId: pred.placeId || pred.place,
                primaryText: pred.mainText?.text || pred.text?.text || query,
                secondaryText: pred.secondaryText?.text || '',
                fullAddress: pred.text?.text || pred.mainText?.text || query,
              };
            });
          }
        }
      }
    } catch (sdkErr) {
      console.warn('Google Maps JS SDK Autocomplete notice:', sdkErr);
    }
  }

  // Matching from landmark database as fallback if no API key or network failure
  const lower = query.toLowerCase();
  const matched = COMMON_LANDMARKS.filter(
    (l) =>
      l.primaryText.toLowerCase().includes(lower) ||
      l.secondaryText.toLowerCase().includes(lower) ||
      l.fullAddress.toLowerCase().includes(lower)
  );

  if (matched.length > 0) {
    return matched;
  }

  // Provide dynamic suggestion for custom input
  return [
    {
      placeId: `custom-${Date.now()}`,
      primaryText: query,
      secondaryText: 'Custom Entered Location',
      fullAddress: query,
    },
  ];
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

    // Attempt 3: JS SDK Place class
    try {
      const google = await loadGoogleMapsSDK(key);
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
