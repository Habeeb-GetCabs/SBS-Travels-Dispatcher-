-- ==============================================================================
-- SBS TRAVELS — DATABASE SCHEMA & RLS MIGRATION
-- Brand: SBS Travels (Powered by Get Taxi Basheer)
-- Backend: Supabase (PostgreSQL)
-- ==============================================================================

-- 1. DRIVER STATUS & ENUMS
CREATE TYPE driver_operational_status AS ENUM ('OFFLINE', 'READY', 'HAS_TRIP', 'ON_TRIP');
CREATE TYPE device_activation_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE trip_status AS ENUM ('OPEN', 'CLAIMED', 'STARTED', 'COMPLETED', 'CANCELLED');
CREATE TYPE user_role AS ENUM ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER', 'DRIVER');

-- 2. ADMIN USERS TABLE
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'DISPATCHER',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. DRIVERS TABLE
CREATE TABLE IF NOT EXISTS public.drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    driver_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL UNIQUE,
    vehicle_number TEXT NOT NULL,
    vehicle_model TEXT,
    operational_status driver_operational_status NOT NULL DEFAULT 'OFFLINE',
    activation_status device_activation_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. DRIVER DEVICES TABLE
CREATE TABLE IF NOT EXISTS public.driver_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    device_fingerprint TEXT NOT NULL,
    device_model TEXT,
    app_version TEXT,
    status device_activation_status NOT NULL DEFAULT 'PENDING',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (driver_id, device_fingerprint)
);

-- 5. TRIPS TABLE (Server-Authoritative Trip Engine)
CREATE TABLE IF NOT EXISTS public.trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_number TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_mobile TEXT NOT NULL,
    pickup_address TEXT NOT NULL,
    drop_address TEXT NOT NULL,
    pickup_latitude NUMERIC(10, 7),
    pickup_longitude NUMERIC(10, 7),
    drop_latitude NUMERIC(10, 7),
    drop_longitude NUMERIC(10, 7),
    trip_type TEXT NOT NULL DEFAULT 'ONE_WAY', -- LOCAL, OUTSTATION, ONE_WAY, ROUND_TRIP
    estimated_fare NUMERIC(10, 2) DEFAULT 0,
    notes TEXT,
    status trip_status NOT NULL DEFAULT 'OPEN',
    trip_access_otp TEXT NOT NULL, -- 6-digit one-time access OTP
    is_otp_consumed BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_by_driver_id UUID REFERENCES public.drivers(id),
    claimed_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.admin_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. TRIP CLAIMS AUDIT (First-Driver-Wins Logging)
CREATE TABLE IF NOT EXISTS public.trip_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES public.drivers(id),
    device_id UUID REFERENCES public.driver_devices(id),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claim_status TEXT NOT NULL -- 'WON' or 'COLLISION_REJECTED'
);

-- 7. COMPLETED TRIPS TABLE (Final Summaries)
CREATE TABLE IF NOT EXISTS public.completed_trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL UNIQUE REFERENCES public.trips(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES public.drivers(id),
    distance_km NUMERIC(8, 2) NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    waiting_seconds INTEGER NOT NULL DEFAULT 0,
    base_fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
    distance_fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
    waiting_fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
    extra_charges NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    actor_id UUID,
    target_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- ATOMIC FIRST-DRIVER-WINS CLAIM RPC FUNCTION
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.claim_trip_atomic(
    p_driver_id UUID,
    p_device_id TEXT,
    p_access_otp TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_trip RECORD;
    v_driver RECORD;
BEGIN
    -- 1. Check Driver and Device Status
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver record not found.');
    END IF;

    IF v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver device is not active or authorized.');
    END IF;

    -- 2. Find and Lock Trip (Row-level lock for atomic claim)
    SELECT * INTO v_trip 
    FROM public.trips 
    WHERE trip_access_otp = p_access_otp 
      AND is_otp_consumed = FALSE 
      AND status = 'OPEN'
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Check if it was already claimed
        SELECT * INTO v_trip FROM public.trips WHERE trip_access_otp = p_access_otp;
        IF FOUND THEN
            -- Record collision attempt
            INSERT INTO public.trip_claims (trip_id, driver_id, device_id, claim_status)
            VALUES (v_trip.id, p_driver_id, p_device_id, 'COLLISION_REJECTED');

            RETURN jsonb_build_object('success', false, 'message', 'Trip already claimed by another driver.');
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Invalid Trip Access OTP.');
        END IF;
    END IF;

    -- 3. Atomic Assignment (First Driver Wins)
    UPDATE public.trips
    SET 
        status = 'CLAIMED',
        claimed_by_driver_id = p_driver_id,
        claimed_at = NOW(),
        is_otp_consumed = TRUE,
        updated_at = NOW()
    WHERE id = v_trip.id;

    -- Update driver status
    UPDATE public.drivers
    SET operational_status = 'HAS_TRIP', updated_at = NOW()
    WHERE id = p_driver_id;

    -- Record winning claim
    INSERT INTO public.trip_claims (trip_id, driver_id, device_id, claim_status)
    VALUES (v_trip.id, p_driver_id, p_device_id, 'WON');

    -- Audit log
    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES ('TRIP_CLAIMED', p_driver_id, v_trip.id, jsonb_build_object('otp', p_access_otp));

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', v_trip.id,
        'trip_number', v_trip.trip_number,
        'customer_name', v_trip.customer_name,
        'customer_mobile', v_trip.customer_mobile,
        'pickup_address', v_trip.pickup_address,
        'drop_address', v_trip.drop_address,
        'estimated_fare', v_trip.estimated_fare
    );
END;
$$;

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completed_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Anonymous/Authenticated Drivers can execute the atomic claim function
GRANT EXECUTE ON FUNCTION public.claim_trip_atomic TO authenticated, anon;
