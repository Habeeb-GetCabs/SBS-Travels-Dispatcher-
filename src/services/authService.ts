import { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { AdminUserProfile, AdminRole, DriverProfile } from '../types';

export const ALLOWED_ADMIN_ROLES: AdminRole[] = ['MASTER_ADMIN', 'ADMIN', 'DISPATCHER'];

/**
 * Cached driver profile key in localStorage for offline presentation and recovery.
 * NOTE: LocalStorage is purely a display/offline cache and NEVER the authorization authority.
 */
export const LOCAL_DRIVER_AUTH_CACHE_KEY = 'sbs_driver_authenticated_profile_v1';

/**
 * Retrieves the active Supabase Auth session for the dispatcher.
 */
export const getDispatcherSession = async (): Promise<Session | null> => {
  if (!isSupabaseConfigured() || !supabase) {
    return null;
  }
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      return null;
    }
    return data.session;
  } catch (err) {
    console.warn('Error fetching dispatcher session:', err);
    return null;
  }
};

/**
 * Retrieves the active Supabase Auth user.
 */
export const getDispatcherUser = async (): Promise<User | null> => {
  const session = await getDispatcherSession();
  return session?.user || null;
};

/**
 * Queries public.admin_users using session.user.id to authoritatively verify
 * that the user is an authorized Administrator or Dispatcher.
 */
export const fetchAdminProfile = async (userId: string): Promise<AdminUserProfile | null> => {
  if (!isSupabaseConfigured() || !supabase || !userId) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, email, full_name, role, created_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return null;
    }

    if (!ALLOWED_ADMIN_ROLES.includes(data.role as AdminRole)) {
      return null;
    }

    return {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      role: data.role as AdminRole,
      createdAt: data.created_at,
    };
  } catch (err) {
    console.warn('Error fetching admin profile from admin_users:', err);
    return null;
  }
};

/**
 * Verifies both the active Supabase session and the corresponding public.admin_users record.
 * If the user has a valid Supabase Auth session but is NOT in public.admin_users,
 * signs them out immediately to preserve least privilege.
 */
export const verifyDispatcherSession = async (): Promise<{
  session: Session | null;
  profile: AdminUserProfile | null;
}> => {
  const session = await getDispatcherSession();
  if (!session || !session.user) {
    return { session: null, profile: null };
  }

  const profile = await fetchAdminProfile(session.user.id);
  if (!profile) {
    // Authenticated in auth.users, but unauthorized in admin_users: sign out safely
    if (supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    return { session: null, profile: null };
  }

  return { session, profile };
};

/**
 * Signs in a dispatcher or administrator using Supabase Auth.
 * Authoritatively verifies their role in public.admin_users.
 */
export const signInDispatcher = async (
  email: string,
  password: string
): Promise<{
  success: boolean;
  profile?: AdminUserProfile;
  session?: Session;
  error?: string;
}> => {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = password;

  if (!cleanEmail || !cleanPassword) {
    return { success: false, error: 'Please enter both email and password.' };
  }

  if (!isSupabaseConfigured() || !supabase) {
    return {
      success: false,
      error: 'Supabase is not configured. Please verify your Supabase URL and anon key in settings.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword,
    });

    if (error) {
      return { success: false, error: error.message || 'Invalid email or password.' };
    }

    if (!data.session || !data.user) {
      return { success: false, error: 'Failed to establish an authenticated session.' };
    }

    // Authoritative verification against public.admin_users
    const adminProfile = await fetchAdminProfile(data.user.id);

    if (!adminProfile) {
      // User is authenticated in auth.users, but not provisioned or authorized in public.admin_users
      await supabase.auth.signOut().catch(() => {});
      return {
        success: false,
        error: 'Access Denied: Your account is not registered as an authorized Dispatcher or Administrator.',
      };
    }

    return {
      success: true,
      profile: adminProfile,
      session: data.session,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Authentication failed due to an unexpected connection error.',
    };
  }
};

/**
 * Signs out the active dispatcher and revokes the local session.
 */
export const signOutDispatcher = async (): Promise<{ success: boolean; error?: string }> => {
  if (!isSupabaseConfigured() || !supabase) {
    return { success: true };
  }

  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error signing out.' };
  }
};

/**
 * Listens for auth state changes (session refreshed, signed out, token expired).
 */
export const onDispatcherAuthStateChange = (
  callback: (session: Session | null, profile: AdminUserProfile | null) => void
): (() => void) => {
  if (!isSupabaseConfigured() || !supabase) {
    return () => {};
  }

  const client = supabase;

  const { data: authListener } = client.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      const profile = await fetchAdminProfile(session.user.id);
      if (!profile) {
        // Unauthorized
        await client.auth.signOut().catch(() => {});
        callback(null, null);
      } else {
        callback(session, profile);
      }
    } else {
      callback(null, null);
    }
  });

  return () => {
    authListener.subscription.unsubscribe();
  };
};

// ==============================================================================
// DRIVER AUTHENTICATION & IDENTITY BINDING (PHASE 2.2C)
// Identity Chain:
//   Supabase Auth auth.users.id (auth.uid())
//       ↓
//   public.drivers.auth_user_id
//       ↓
//   Authoritative public.drivers.id
//       ↓
//   public.driver_devices.driver_id
// ==============================================================================

/**
 * Retrieves the active Supabase Auth session for the driver client.
 */
export const getDriverSession = async (): Promise<Session | null> => {
  if (!isSupabaseConfigured() || !supabase) {
    return null;
  }
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      return null;
    }
    return data.session;
  } catch (err) {
    console.warn('Error fetching driver session:', err);
    return null;
  }
};

/**
 * Retrieves the active Supabase Auth user.
 */
export const getDriverUser = async (): Promise<User | null> => {
  const session = await getDriverSession();
  return session?.user || null;
};

/**
 * Authoritatively resolves the DriverProfile from the database using auth.uid().
 * The identity relationship enforced is:
 *   public.drivers.auth_user_id = auth.uid()
 * Then loads the authoritative drivers.id, driver details, and registered device.
 */
export const fetchDriverProfileByAuthUid = async (
  authUserId: string
): Promise<DriverProfile | null> => {
  if (!isSupabaseConfigured() || !supabase || !authUserId) {
    return null;
  }

  try {
    const { data: driverData, error: driverError } = await supabase
      .from('drivers')
      .select('id, auth_user_id, driver_code, name, mobile, vehicle_number, vehicle_model, operational_status, activation_status')
      .eq('auth_user_id', authUserId)
      .single();

    if (driverError || !driverData) {
      return null;
    }

    // Resolve registered device from public.driver_devices for this driver
    let deviceFingerprint = `DEV-SBS-${driverData.driver_code}`;
    let deviceStatus = driverData.activation_status;

    const { data: deviceData } = await supabase
      .from('driver_devices')
      .select('id, device_fingerprint, status')
      .eq('driver_id', driverData.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (deviceData && deviceData.length > 0) {
      deviceFingerprint = deviceData[0].device_fingerprint || deviceFingerprint;
      deviceStatus = deviceData[0].status || deviceStatus;
    }

    const resolvedProfile: DriverProfile = {
      id: driverData.id, // Server-Authoritative UUID
      authUserId: driverData.auth_user_id,
      driverCode: driverData.driver_code,
      name: driverData.name,
      mobile: driverData.mobile,
      vehicleNumber: driverData.vehicle_number,
      vehicleModel: driverData.vehicle_model || '',
      operationalStatus: driverData.operational_status,
      activationStatus: driverData.activation_status,
      deviceId: deviceFingerprint,
    };

    // Cache locally for offline presentation / recovery
    if (typeof window !== 'undefined') {
      localStorage.setItem(LOCAL_DRIVER_AUTH_CACHE_KEY, JSON.stringify(resolvedProfile));
    }

    return resolvedProfile;
  } catch (err) {
    console.warn('Error resolving driver profile by auth.uid():', err);
    return null;
  }
};

/**
 * Verifies both the active Supabase Auth session and the corresponding public.drivers record.
 */
export const verifyDriverSession = async (): Promise<{
  session: Session | null;
  profile: DriverProfile | null;
  isLinked: boolean;
}> => {
  const session = await getDriverSession();
  if (!session || !session.user) {
    return { session: null, profile: null, isLinked: false };
  }

  const profile = await fetchDriverProfileByAuthUid(session.user.id);
  if (!profile) {
    // Authenticated user in auth.users, but not linked to any driver record
    return { session, profile: null, isLinked: false };
  }

  return { session, profile, isLinked: true };
};

/**
 * Signs in a driver using Supabase Auth (e.g. email / driver credentials).
 * Resolves public.drivers.auth_user_id = auth.uid() to establish authoritative driver identity.
 */
export const signInDriver = async (
  email: string,
  password: string
): Promise<{
  success: boolean;
  profile?: DriverProfile;
  session?: Session;
  error?: string;
}> => {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPassword = password;

  if (!cleanEmail || !cleanPassword) {
    return { success: false, error: 'Please enter both driver email and password.' };
  }

  if (!isSupabaseConfigured() || !supabase) {
    return {
      success: false,
      error: 'Supabase is not configured. Please verify your Supabase URL and anon key in settings.',
    };
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: cleanPassword,
    });

    if (error) {
      return { success: false, error: error.message || 'Invalid driver credentials.' };
    }

    if (!data.session || !data.user) {
      return { success: false, error: 'Failed to establish an authenticated driver session.' };
    }

    // Authoritative verification against public.drivers WHERE auth_user_id = auth.uid()
    const driverProfile = await fetchDriverProfileByAuthUid(data.user.id);

    if (!driverProfile) {
      // User is authenticated in auth.users, but no driver record is linked
      return {
        success: false,
        error: 'Account Not Linked: No driver profile is associated with this login. Please contact SBS Dispatch.',
      };
    }

    return {
      success: true,
      profile: driverProfile,
      session: data.session,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Driver authentication failed due to a network connection error.',
    };
  }
};

/**
 * Signs out the driver and clears driver auth session.
 */
export const signOutDriver = async (): Promise<{ success: boolean; error?: string }> => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(LOCAL_DRIVER_AUTH_CACHE_KEY);
  }

  if (!isSupabaseConfigured() || !supabase) {
    return { success: true };
  }

  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error signing out driver.' };
  }
};

/**
 * Listens for driver auth state changes (session refresh, token expiry, logout).
 */
export const onDriverAuthStateChange = (
  callback: (session: Session | null, profile: DriverProfile | null) => void
): (() => void) => {
  if (!isSupabaseConfigured() || !supabase) {
    return () => {};
  }

  const client = supabase;

  const { data: authListener } = client.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      const profile = await fetchDriverProfileByAuthUid(session.user.id);
      callback(session, profile);
    } else {
      callback(null, null);
    }
  });

  return () => {
    authListener.subscription.unsubscribe();
  };
};

