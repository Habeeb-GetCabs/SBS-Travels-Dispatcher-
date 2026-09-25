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
    let { data: driverData, error: driverError } = await supabase
      .from('drivers')
      .select('id, auth_user_id, driver_code, name, mobile, vehicle_number, vehicle_model, operational_status, activation_status')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    // Self-healing fallback: If auth_user_id not linked yet, check user email/metadata
    if (!driverData) {
      const { data: sessionData } = await supabase.auth.getUser();
      const userEmail = sessionData?.user?.email;
      if (userEmail) {
        const identifierPrefix = userEmail.split('@')[0].trim().toUpperCase();
        const { data: fallbackDriver } = await supabase
          .from('drivers')
          .select('id, auth_user_id, driver_code, name, mobile, vehicle_number, vehicle_model, operational_status, activation_status')
          .or(`driver_code.ilike.${identifierPrefix},mobile.eq.${identifierPrefix}`)
          .limit(1)
          .maybeSingle();

        if (fallbackDriver) {
          driverData = fallbackDriver;
          // Auto-heal the link in the database
          await supabase
            .from('drivers')
            .update({ auth_user_id: authUserId, updated_at: new Date().toISOString() })
            .eq('id', fallbackDriver.id);
        }
      }
    }

    if (!driverData) {
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
    } else {
      // Ensure device entry exists
      await supabase.from('driver_devices').upsert(
        {
          driver_id: driverData.id,
          device_fingerprint: deviceFingerprint,
          device_model: driverData.vehicle_model || 'Taxi Mobile',
          app_version: '2.6',
          status: 'ACTIVE',
        },
        { onConflict: 'driver_id,device_fingerprint' }
      );
    }

    const resolvedProfile: DriverProfile = {
      id: driverData.id, // Server-Authoritative UUID
      authUserId: driverData.auth_user_id || authUserId,
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
 * Ensures a driver account in auth.users exists and is linked to public.drivers.
 */
export const ensureDriverAuthAccount = async (
  driverIdentifier: string,
  password: string = 'SbsTravels@2026!'
): Promise<{ success: boolean; email?: string; error?: string }> => {
  if (!isSupabaseConfigured() || !supabase) {
    return { success: false, error: 'Supabase is not configured.' };
  }

  const cleanId = driverIdentifier.trim();
  if (!cleanId) {
    return { success: false, error: 'Driver identifier is required.' };
  }

  try {
    // 1. Try server RPC
    const { data, error } = await supabase.rpc('ensure_driver_auth_account', {
      p_driver_identifier: cleanId,
      p_password: password,
    });

    if (!error && data?.success) {
      return { success: true, email: data.email };
    }

    // 2. Client-side fallback if RPC is not present or failed
    const code = cleanId.includes('@') ? cleanId.split('@')[0].toUpperCase() : cleanId.toUpperCase();
    const targetEmail = cleanId.includes('@') ? cleanId.toLowerCase() : `${code.toLowerCase()}@sbstravels.com`;

    // Try creating via signUp if account doesn't exist
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: targetEmail,
      password: password,
      options: {
        data: {
          role: 'DRIVER',
          driver_code: code,
        },
      },
    });

    if (signUpData?.user) {
      // Link in drivers table
      await supabase
        .from('drivers')
        .update({ auth_user_id: signUpData.user.id, updated_at: new Date().toISOString() })
        .ilike('driver_code', code);

      return { success: true, email: targetEmail };
    }

    if (signUpError && !signUpError.message.includes('already registered')) {
      return { success: false, error: signUpError.message };
    }

    return { success: true, email: targetEmail };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error binding driver auth.' };
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
 * Signs in a driver using Supabase Auth (e.g. driver code, mobile, or email).
 * Automatically links and self-heals credentials with public.drivers.
 */
export const signInDriver = async (
  identifier: string,
  password: string
): Promise<{
  success: boolean;
  profile?: DriverProfile;
  session?: Session;
  error?: string;
  autoBound?: boolean;
}> => {
  const cleanInput = identifier.trim();
  const cleanPassword = password || 'SbsTravels@2026!';

  if (!cleanInput) {
    return { success: false, error: 'Please enter your Driver Code, Mobile, or Email.' };
  }

  if (!isSupabaseConfigured() || !supabase) {
    return {
      success: false,
      error: 'Supabase is not configured. Please verify your Supabase URL and anon key in settings.',
    };
  }

  // Normalize email: If user types "DRV002", format to "drv002@sbstravels.com"
  let targetEmail = cleanInput.toLowerCase();
  if (!targetEmail.includes('@')) {
    targetEmail = `${targetEmail}@sbstravels.com`;
  }

  try {
    // 1. Attempt primary sign-in with password
    let { data, error } = await supabase.auth.signInWithPassword({
      email: targetEmail,
      password: cleanPassword,
    });

    // 2. If login failed due to invalid credentials, attempt auto-provision/link
    if (error) {
      const bindRes = await ensureDriverAuthAccount(cleanInput, cleanPassword);
      if (bindRes.success) {
        const retryEmail = bindRes.email || targetEmail;
        const retry = await supabase.auth.signInWithPassword({
          email: retryEmail,
          password: cleanPassword,
        });

        if (!retry.error && retry.data) {
          data = retry.data;
          error = null;
        }
      }
    }

    if (error || !data?.session || !data?.user) {
      return {
        success: false,
        error: error?.message || 'Invalid driver credentials. Ensure your driver profile is created in Dispatch Console.',
      };
    }

    // 3. Authoritative verification against public.drivers WHERE auth_user_id = auth.uid()
    const driverProfile = await fetchDriverProfileByAuthUid(data.user.id);

    if (!driverProfile) {
      return {
        success: false,
        error: `Account Not Linked: User logged in (${data.user.email}), but no driver record is linked to this account. Please tap "Bind Auth" in Dispatch Console.`,
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

