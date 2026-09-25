// Master Supabase PostgreSQL SQL Schema for SBS Travels
// Run this in your Supabase Dashboard -> SQL Editor

export const SBS_TRAVELS_SQL_SCHEMA = `-- ==============================================================================
-- SBS TRAVELS — DATABASE SCHEMA & RLS MIGRATION
-- Brand: SBS Travels (Powered by Get Taxi Basheer)
-- Backend: Supabase (PostgreSQL)
-- ==============================================================================

-- 1. ENUMS (Safe creation)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_operational_status') THEN
        CREATE TYPE driver_operational_status AS ENUM ('OFFLINE', 'READY', 'TRIP_CLAIMED', 'ARRIVED', 'ON_TRIP', 'COMPLETING', 'AVAILABLE', 'SUSPENDED');
    ELSE
        -- Ensure all labels exist
        ALTER TYPE driver_operational_status ADD VALUE IF NOT EXISTS 'TRIP_CLAIMED';
        ALTER TYPE driver_operational_status ADD VALUE IF NOT EXISTS 'ARRIVED';
        ALTER TYPE driver_operational_status ADD VALUE IF NOT EXISTS 'COMPLETING';
        ALTER TYPE driver_operational_status ADD VALUE IF NOT EXISTS 'AVAILABLE';
        ALTER TYPE driver_operational_status ADD VALUE IF NOT EXISTS 'SUSPENDED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_activation_status') THEN
        CREATE TYPE device_activation_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trip_status') THEN
        CREATE TYPE trip_status AS ENUM ('OPEN', 'CLAIMED', 'ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER', 'DRIVER');
    END IF;
END $$;

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
    operational_status driver_operational_status NOT NULL DEFAULT 'READY',
    activation_status device_activation_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure auth_user_id exists if public.drivers was created prior to Phase 2.2C
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'drivers' 
          AND column_name = 'auth_user_id'
    ) THEN
        ALTER TABLE public.drivers 
        ADD COLUMN auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 4. DRIVER DEVICES TABLE
CREATE TABLE IF NOT EXISTS public.driver_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    device_fingerprint TEXT NOT NULL,
    device_model TEXT,
    app_version TEXT,
    status device_activation_status NOT NULL DEFAULT 'ACTIVE',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (driver_id, device_fingerprint)
);

-- 5. TRIPS TABLE (Server-Authoritative Trip Engine with Custom Per-Trip Tariff)
CREATE TABLE IF NOT EXISTS public.trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_number TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    customer_mobile TEXT NOT NULL,
    pickup_address TEXT NOT NULL,
    drop_address TEXT NOT NULL,
    pickup_latitude NUMERIC(10, 7),
    pickup_longitude NUMERIC(10, 7),
    pickup_place_id TEXT,
    drop_latitude NUMERIC(10, 7),
    drop_longitude NUMERIC(10, 7),
    drop_place_id TEXT,
    trip_type TEXT NOT NULL DEFAULT 'ONE_WAY',
    estimated_fare NUMERIC(10, 2) DEFAULT 0,
    estimated_distance_km NUMERIC(8,2) DEFAULT 0,
    estimated_duration_minutes INTEGER DEFAULT 0,
    tariff_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    passenger_otp_required BOOLEAN NOT NULL DEFAULT FALSE,
    passenger_verification_otp TEXT,
    passenger_verified_at TIMESTAMPTZ,
    passenger_verification_attempts INTEGER NOT NULL DEFAULT 0,
    passenger_verification_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    notes TEXT,
    status trip_status NOT NULL DEFAULT 'OPEN',
    trip_access_otp TEXT NOT NULL,
    is_otp_consumed BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_by_driver_id UUID REFERENCES public.drivers(id),
    claimed_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    start_pin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. TRIP CLAIMS AUDIT (First-Driver-Wins Logging)
CREATE TABLE IF NOT EXISTS public.trip_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES public.drivers(id),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claim_status TEXT NOT NULL
);

-- 7. COMPLETED TRIPS TABLE (Final Summaries)
CREATE TABLE IF NOT EXISTS public.completed_trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL UNIQUE REFERENCES public.trips(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES public.drivers(id),
    distance_km NUMERIC(8, 2) NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    waiting_seconds INTEGER NOT NULL DEFAULT 0,
    base_fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
    distance_fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
    waiting_fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
    driver_bata NUMERIC(10, 2) NOT NULL DEFAULT 0,
    toll NUMERIC(10, 2) NOT NULL DEFAULT 0,
    parking NUMERIC(10, 2) NOT NULL DEFAULT 0,
    interstate_tax NUMERIC(10, 2) NOT NULL DEFAULT 0,
    extra_charges NUMERIC(10, 2) NOT NULL DEFAULT 0,
    discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_fare NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tariff_config JSONB DEFAULT '{}'::jsonb,
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

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_trips_access_otp ON public.trips(trip_access_otp);
CREATE INDEX IF NOT EXISTS idx_trips_status ON public.trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_claimed_driver ON public.trips(claimed_by_driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON public.trips(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_auth_user_id ON public.drivers(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- RPC 1: ATOMIC TRIP CLAIM (Hardened with Driver Identity Verification)
CREATE OR REPLACE FUNCTION public.claim_trip_atomic(
    p_driver_id UUID,
    p_device_id TEXT,
    p_access_otp TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trip RECORD;
    v_driver RECORD;
    v_device RECORD;
    v_clean_otp TEXT;
BEGIN
    -- 1. Enforce Authenticated Supabase Caller
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Authentication required. Driver must be logged in with an active Supabase session.'
        );
    END IF;

    -- 2. Authoritatively Verify Caller Identity against drivers.auth_user_id
    SELECT * INTO v_driver 
    FROM public.drivers 
    WHERE id = p_driver_id AND auth_user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Driver profile not found or does not belong to authenticated account.'
        );
    END IF;

    -- 3. Check Driver Activation Status
    IF v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Driver account is ' || v_driver.activation_status || '. Authorization required.'
        );
    END IF;

    -- 4. Check Driver Device Authorization (Strict match only, no fallback!)
    SELECT * INTO v_device 
    FROM public.driver_devices 
    WHERE driver_id = p_driver_id 
      AND (device_fingerprint = p_device_id OR id::text = p_device_id);

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Device not authorized. Please contact dispatch.'
        );
    END IF;

    IF v_device.status != 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Device not authorized. Please contact dispatch.'
        );
    END IF;

    v_clean_otp := trim(p_access_otp);

    -- 5. Atomic First-Driver-Wins Trip Lock
    SELECT * INTO v_trip 
    FROM public.trips 
    WHERE trip_access_otp = v_clean_otp 
      AND is_otp_consumed = FALSE 
      AND status = 'OPEN'
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT * INTO v_trip FROM public.trips WHERE trip_access_otp = v_clean_otp;
        IF FOUND THEN
            INSERT INTO public.trip_claims (trip_id, driver_id, claim_status)
            VALUES (v_trip.id, p_driver_id, 'COLLISION_REJECTED');

            INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
            VALUES ('TRIP_CLAIM_COLLISION', p_driver_id, v_trip.id, jsonb_build_object('otp', v_clean_otp));

            RETURN jsonb_build_object('success', false, 'message', 'Trip already claimed by another driver.');
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Invalid Trip Access OTP.');
        END IF;
    END IF;

    -- 6. Transition State: OPEN -> CLAIMED
    UPDATE public.trips
    SET 
        status = 'CLAIMED',
        claimed_by_driver_id = p_driver_id,
        claimed_at = NOW(),
        is_otp_consumed = TRUE,
        updated_at = NOW()
    WHERE id = v_trip.id;

    UPDATE public.drivers
    SET operational_status = 'TRIP_CLAIMED', updated_at = NOW()
    WHERE id = p_driver_id;

    INSERT INTO public.trip_claims (trip_id, driver_id, claim_status)
    VALUES (v_trip.id, p_driver_id, 'WON');

    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES ('TRIP_CLAIMED', p_driver_id, v_trip.id, jsonb_build_object('otp', v_clean_otp));

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', v_trip.id,
        'trip_number', v_trip.trip_number,
        'customer_name', v_trip.customer_name,
        'customer_mobile', v_trip.customer_mobile,
        'pickup_address', v_trip.pickup_address,
        'drop_address', v_trip.drop_address,
        'pickup_latitude', v_trip.pickup_latitude,
        'pickup_longitude', v_trip.pickup_longitude,
        'drop_latitude', v_trip.drop_latitude,
        'drop_longitude', v_trip.drop_longitude,
        'estimated_fare', v_trip.estimated_fare,
        'tariff_config', v_trip.tariff_config,
        'passenger_otp_required', v_trip.passenger_otp_required,
        'passenger_verification_status', v_trip.passenger_verification_status,
        'status', 'CLAIMED'
    );
END;
$$;

-- RPC 2: MARK TRIP ARRIVED
CREATE OR REPLACE FUNCTION public.mark_trip_arrived(
    p_trip_id UUID,
    p_driver_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trip RECORD;
    v_driver RECORD;
BEGIN
    -- 1. Enforce Authenticated Supabase Caller
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Authentication required. Driver must be logged in with an active Supabase session.'
        );
    END IF;

    -- 2. Authoritatively Verify Caller Identity against drivers.auth_user_id
    SELECT * INTO v_driver 
    FROM public.drivers 
    WHERE id = p_driver_id AND auth_user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Driver identity mismatch.'
        );
    END IF;

    IF v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Driver is not active. Status: ' || v_driver.activation_status
        );
    END IF;

    -- 3. Lock Trip and Validate Status is CLAIMED (or already ARRIVED)
    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip record not found or not assigned to driver.');
    END IF;

    -- Idempotency: If already ARRIVED, return safe success
    IF v_trip.status = 'ARRIVED' THEN
        RETURN jsonb_build_object(
            'success', true, 
            'trip_id', p_trip_id, 
            'status', 'ARRIVED', 
            'arrived_at', v_trip.arrived_at,
            'passenger_otp_required', v_trip.passenger_otp_required,
            'passenger_verification_status', v_trip.passenger_verification_status
        );
    END IF;

    IF v_trip.status != 'CLAIMED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip must be in CLAIMED status to mark arrived. Current status: ' || v_trip.status);
    END IF;

    -- 4. Transition State: CLAIMED -> ARRIVED
    UPDATE public.trips
    SET 
        status = 'ARRIVED',
        arrived_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trip_id;

    UPDATE public.drivers
    SET operational_status = 'ARRIVED', updated_at = NOW()
    WHERE id = p_driver_id;

    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES ('TRIP_ARRIVED', p_driver_id, p_trip_id, jsonb_build_object('arrived_at', NOW()));

    RETURN jsonb_build_object(
        'success', true, 
        'trip_id', p_trip_id, 
        'status', 'ARRIVED', 
        'arrived_at', NOW(),
        'passenger_otp_required', v_trip.passenger_otp_required,
        'passenger_verification_status', v_trip.passenger_verification_status
    );
END;
$$;

-- RPC 3: START TRIP ATOMIC (Server-side PIN verification)
CREATE OR REPLACE FUNCTION public.start_trip_atomic(
    p_trip_id UUID,
    p_driver_id UUID,
    p_start_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trip RECORD;
    v_driver RECORD;
BEGIN
    -- 1. Enforce Authenticated Supabase Caller
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Authentication required. Driver must be logged in with an active Supabase session.'
        );
    END IF;

    -- 2. Authoritatively Verify Caller Identity against drivers.auth_user_id
    SELECT * INTO v_driver 
    FROM public.drivers 
    WHERE id = p_driver_id AND auth_user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: Driver identity mismatch.');
    END IF;

    IF v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver account is inactive. Please contact dispatch.');
    END IF;

    -- 3. Lock Trip and Validate Status is ARRIVED
    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id AND status = 'ARRIVED'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip must be in ARRIVED status before starting meter.');
    END IF;

    -- 4. Validate Trip-Specific Start PIN (No global shared pin, no silent fallback!)
    IF v_trip.start_pin IS NULL OR trim(p_start_pin) != trim(v_trip.start_pin) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid start PIN.');
    END IF;

    -- 5. Enforce Passenger Verification Gate if Required
    IF v_trip.passenger_otp_required = TRUE AND v_trip.passenger_verification_status != 'VERIFIED' THEN
        RETURN jsonb_build_object(
            'success', false, 
            'message', 'Passenger Verification OTP must be verified before starting the meter.'
        );
    END IF;

    -- 6. Validate Tariff Configuration Exists
    IF v_trip.tariff_config IS NULL OR v_trip.tariff_config = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip has missing tariff configuration. Please contact dispatch.');
    END IF;

    -- 7. Transition to STARTED
    UPDATE public.trips
    SET 
        status = 'STARTED',
        started_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trip_id;

    UPDATE public.drivers
    SET operational_status = 'ON_TRIP', updated_at = NOW()
    WHERE id = p_driver_id;

    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES ('TRIP_STARTED', p_driver_id, p_trip_id, jsonb_build_object('started_at', NOW()));

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', p_trip_id,
        'status', 'STARTED',
        'started_at', NOW(),
        'tariff_config', v_trip.tariff_config
    );
END;
$$;

-- RPC 4: COMPLETE TRIP ATOMIC
CREATE OR REPLACE FUNCTION public.complete_trip_atomic(
    p_trip_id UUID,
    p_driver_id UUID,
    p_summary JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trip RECORD;
    v_driver RECORD;
    v_total NUMERIC;
BEGIN
    -- 1. Enforce Authenticated Supabase Caller
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Authentication required. Driver must be logged in with an active Supabase session.'
        );
    END IF;

    -- 2. Authoritatively Verify Caller Identity against drivers.auth_user_id
    SELECT * INTO v_driver 
    FROM public.drivers 
    WHERE id = p_driver_id AND auth_user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: Driver identity mismatch.');
    END IF;

    IF v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized or inactive driver.');
    END IF;

    -- 3. Lock and Validate Trip Ownership
    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Trip record not found or not assigned to driver.'
        );
    END IF;

    -- 4. Idempotency: If already finalized, return success safely
    IF v_trip.status = 'COMPLETED' THEN
        RETURN jsonb_build_object(
            'success', true, 
            'trip_id', p_trip_id, 
            'status', 'COMPLETED', 
            'message', 'Trip already finalized and completed.'
        );
    END IF;

    -- 5. Strictly Enforce Current Status is STARTED
    IF v_trip.status != 'STARTED' THEN
        RETURN jsonb_build_object(
            'success', false, 
            'message', 'Trip must be in STARTED status before completion. Current status: ' || v_trip.status
        );
    END IF;

    v_total := COALESCE((p_summary->>'totalFare')::numeric, 0);

    -- 6. Authoritatively Transition Trip to COMPLETED
    UPDATE public.trips
    SET 
        status = 'COMPLETED',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trip_id;

    -- 7. Authoritatively Reset Driver Operational Status to READY
    UPDATE public.drivers
    SET 
        operational_status = 'READY',
        updated_at = NOW()
    WHERE id = p_driver_id;

    -- 8. Insert Itemized Completed Trip Record (Unique on trip_id)
    INSERT INTO public.completed_trips (
        trip_id,
        driver_id,
        distance_km,
        duration_seconds,
        waiting_seconds,
        base_fare,
        distance_fare,
        waiting_fare,
        driver_bata,
        toll,
        parking,
        interstate_tax,
        extra_charges,
        discount,
        total_fare,
        tariff_config,
        completed_at
    ) VALUES (
        p_trip_id,
        p_driver_id,
        COALESCE((p_summary->>'distanceKm')::numeric, 0),
        COALESCE((p_summary->>'durationSeconds')::integer, 0),
        COALESCE((p_summary->>'waitingSeconds')::integer, 0),
        COALESCE((p_summary->>'baseFare')::numeric, 0),
        COALESCE((p_summary->>'distanceFare')::numeric, 0),
        COALESCE((p_summary->>'waitingFare')::numeric, 0),
        COALESCE((p_summary->>'driverBata')::numeric, 0),
        COALESCE((p_summary->>'toll')::numeric, 0),
        COALESCE((p_summary->>'parking')::numeric, 0),
        COALESCE((p_summary->>'interstateTax')::numeric, 0),
        COALESCE((p_summary->>'extraCharges')::numeric, 0),
        COALESCE((p_summary->>'discount')::numeric, 0),
        v_total,
        v_trip.tariff_config,
        NOW()
    ) ON CONFLICT (trip_id) DO NOTHING;

    -- 9. Insert Audit Log
    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES ('TRIP_COMPLETED', p_driver_id, p_trip_id, jsonb_build_object('totalFare', v_total, 'completed_at', NOW()));

    RETURN jsonb_build_object('success', true, 'trip_id', p_trip_id, 'status', 'COMPLETED', 'totalFare', v_total);
END;
$$;

-- RPC 5: VERIFY PASSENGER OTP (Credential 4)
CREATE OR REPLACE FUNCTION public.verify_passenger_otp(
    p_trip_id UUID,
    p_driver_id UUID,
    p_otp TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trip RECORD;
    v_driver RECORD;
BEGIN
    -- 1. Enforce Authenticated Supabase Caller
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Authentication required. Driver must be logged in with an active Supabase session.'
        );
    END IF;

    -- 2. Authoritatively Verify Caller Identity against drivers.auth_user_id
    SELECT * INTO v_driver 
    FROM public.drivers 
    WHERE id = p_driver_id AND auth_user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: Driver identity mismatch.');
    END IF;

    IF v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver is not active. Status: ' || v_driver.activation_status);
    END IF;

    -- 3. Lock Trip and Validate Status
    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip record not found or not assigned to driver.');
    END IF;

    IF v_trip.status != 'ARRIVED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip must be in ARRIVED status to verify passenger OTP.');
    END IF;

    IF v_trip.passenger_otp_required = FALSE THEN
        RETURN jsonb_build_object('success', true, 'message', 'Passenger verification not required for this trip.', 'status', 'NOT_REQUIRED');
    END IF;

    IF v_trip.passenger_verification_status = 'VERIFIED' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Passenger already verified.', 'status', 'VERIFIED');
    END IF;

    IF v_trip.passenger_verification_status = 'FAILED_BLOCKED' OR v_trip.passenger_verification_attempts >= 5 THEN
        UPDATE public.trips 
        SET passenger_verification_status = 'FAILED_BLOCKED', updated_at = NOW()
        WHERE id = p_trip_id;

        RETURN jsonb_build_object(
            'success', false, 
            'message', 'Maximum OTP verification attempts exceeded. Verification blocked. Contact dispatch.',
            'status', 'FAILED_BLOCKED'
        );
    END IF;

    -- 4. Validate OTP
    IF trim(p_otp) = trim(v_trip.passenger_verification_otp) THEN
        UPDATE public.trips
        SET 
            passenger_verification_status = 'VERIFIED',
            passenger_verified_at = NOW(),
            updated_at = NOW()
        WHERE id = p_trip_id;

        INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
        VALUES ('PASSENGER_OTP_VERIFIED', p_driver_id, p_trip_id, jsonb_build_object('verified_at', NOW()));

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Passenger successfully verified!',
            'status', 'VERIFIED',
            'verified_at', NOW()
        );
    ELSE
        UPDATE public.trips
        SET 
            passenger_verification_attempts = passenger_verification_attempts + 1,
            updated_at = NOW()
        WHERE id = p_trip_id;

        INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
        VALUES ('PASSENGER_OTP_FAILED', p_driver_id, p_trip_id, jsonb_build_object(
            'attempt', v_trip.passenger_verification_attempts + 1,
            'remaining', 5 - (v_trip.passenger_verification_attempts + 1)
        ));

        RETURN jsonb_build_object(
            'success', false,
            'message', 'Incorrect Passenger OTP. Remaining attempts: ' || (4 - v_trip.passenger_verification_attempts),
            'remaining_attempts', 4 - v_trip.passenger_verification_attempts,
            'status', 'PENDING'
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_trip_atomic TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_trip_arrived TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.start_trip_atomic TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.complete_trip_atomic TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.verify_passenger_otp TO authenticated, anon;

-- ==============================================================================
-- HARDENED ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completed_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 0. Admin Users RLS: Allow authenticated user to view their own admin profile
DROP POLICY IF EXISTS "Admin users can view own profile" ON public.admin_users;
CREATE POLICY "Admin users can view own profile"
ON public.admin_users FOR SELECT
TO authenticated
USING (
    id = auth.uid()
);

-- 1. Trips RLS: Registered drivers view OPEN or their own claimed trips; Dispatchers view all
DROP POLICY IF EXISTS "Authorized drivers can view open or own trips" ON public.trips;
CREATE POLICY "Authorized drivers can view open or own trips"
ON public.trips FOR SELECT
TO authenticated
USING (
    (status = 'OPEN' AND auth.uid() IN (SELECT auth_user_id FROM public.drivers WHERE auth_user_id IS NOT NULL))
    OR (auth.uid() IS NOT NULL AND claimed_by_driver_id IN (SELECT id FROM public.drivers WHERE auth_user_id = auth.uid()))
    OR (auth.uid() IS NOT NULL AND auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')))
);

DROP POLICY IF EXISTS "Authorized dispatchers can create trips" ON public.trips;
CREATE POLICY "Authorized dispatchers can create trips"
ON public.trips FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL 
    AND auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'))
);

-- 2. Completed Trips RLS: Revoke direct insert; select restricted to own driver or dispatchers
REVOKE INSERT ON public.completed_trips FROM anon, authenticated, public;

DROP POLICY IF EXISTS "Drivers view own completed trips and dispatchers view all" ON public.completed_trips;
CREATE POLICY "Drivers view own completed trips and dispatchers view all"
ON public.completed_trips FOR SELECT
TO authenticated
USING (
    (auth.uid() IS NOT NULL AND driver_id IN (SELECT id FROM public.drivers WHERE auth_user_id = auth.uid()))
    OR (auth.uid() IS NOT NULL AND auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')))
);

-- 3. Drivers Directory & Status RLS
DROP POLICY IF EXISTS "Drivers can view own profile or dispatchers view all" ON public.drivers;
CREATE POLICY "Drivers can view own profile or dispatchers view all"
ON public.drivers FOR SELECT
TO authenticated
USING (
    (auth.uid() IS NOT NULL AND auth_user_id = auth.uid())
    OR (auth.uid() IS NOT NULL AND auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')))
);

DROP POLICY IF EXISTS "Drivers can update own operational status or dispatchers update all" ON public.drivers;
CREATE POLICY "Drivers can update own operational status or dispatchers update all"
ON public.drivers FOR UPDATE
TO authenticated
USING (
    (auth.uid() IS NOT NULL AND auth_user_id = auth.uid())
    OR (auth.uid() IS NOT NULL AND auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')))
)
WITH CHECK (
    (auth.uid() IS NOT NULL AND auth_user_id = auth.uid())
    OR (auth.uid() IS NOT NULL AND auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')))
);

-- 4. Driver Devices RLS
DROP POLICY IF EXISTS "Drivers and dispatchers view devices" ON public.driver_devices;
CREATE POLICY "Drivers and dispatchers view devices"
ON public.driver_devices FOR SELECT
TO authenticated
USING (
    driver_id IN (SELECT id FROM public.drivers WHERE auth_user_id = auth.uid())
    OR auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'))
);

DROP POLICY IF EXISTS "Drivers and dispatchers update devices" ON public.driver_devices;
CREATE POLICY "Drivers and dispatchers update devices"
ON public.driver_devices FOR UPDATE
TO authenticated
USING (
    driver_id IN (SELECT id FROM public.drivers WHERE auth_user_id = auth.uid())
    OR auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'))
);

DROP POLICY IF EXISTS "Dispatchers can insert driver devices" ON public.driver_devices;
CREATE POLICY "Dispatchers can insert driver devices"
ON public.driver_devices FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL 
    AND auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'))
);

-- Database Enforced Single Active Device per Driver Trigger
CREATE OR REPLACE FUNCTION public.enforce_single_active_device()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'ACTIVE' THEN
        UPDATE public.driver_devices
        SET status = 'DEACTIVATED'::device_activation_status
        WHERE driver_id = NEW.driver_id
          AND id != NEW.id
          AND status = 'ACTIVE';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_single_active_device ON public.driver_devices;
CREATE TRIGGER trg_enforce_single_active_device
BEFORE INSERT OR UPDATE OF status ON public.driver_devices
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_active_device();

-- 5. Dispatcher Logs RLS
DROP POLICY IF EXISTS "Dispatchers can view claim logs" ON public.trip_claims;
CREATE POLICY "Dispatchers can view claim logs"
ON public.trip_claims FOR SELECT
TO authenticated
USING (auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')));

DROP POLICY IF EXISTS "Dispatchers can view audit logs" ON public.audit_logs;
CREATE POLICY "Dispatchers can view audit logs"
ON public.audit_logs FOR SELECT
TO authenticated
USING (auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')));

-- 6. REAL PRODUCTION STAFF ACCOUNTS PROVISIONING
CREATE OR REPLACE FUNCTION public.provision_production_admin_user(
    p_email TEXT,
    p_full_name TEXT,
    p_role user_role,
    p_password TEXT DEFAULT 'SbsTravels@2026!'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_user_id UUID;
    v_existing_auth_id UUID;
BEGIN
    SELECT id INTO v_existing_auth_id
    FROM auth.users
    WHERE LOWER(email) = LOWER(p_email);

    IF v_existing_auth_id IS NOT NULL THEN
        v_user_id := v_existing_auth_id;
        UPDATE auth.users
        SET 
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            encrypted_password = crypt(p_password, gen_salt('bf')),
            updated_at = NOW()
        WHERE id = v_user_id;
    ELSE
        v_user_id := gen_random_uuid();
        INSERT INTO auth.users (
            id,
            instance_id,
            email,
            encrypted_password,
            email_confirmed_at,
            aud,
            role,
            raw_app_meta_data,
            raw_user_meta_data,
            is_super_admin,
            created_at,
            updated_at
        ) VALUES (
            v_user_id,
            '00000000-0000-0000-0000-000000000000',
            LOWER(p_email),
            crypt(p_password, gen_salt('bf')),
            NOW(),
            'authenticated',
            'authenticated',
            '{"provider": "email", "providers": ["email"]}'::jsonb,
            jsonb_build_object('full_name', p_full_name, 'role', p_role),
            false,
            NOW(),
            NOW()
        );
    END IF;

    INSERT INTO public.admin_users (
        id,
        email,
        full_name,
        role,
        updated_at
    ) VALUES (
        v_user_id,
        LOWER(p_email),
        p_full_name,
        p_role,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        updated_at = NOW()
    ON CONFLICT (email) DO UPDATE SET
        id = EXCLUDED.id,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        updated_at = NOW();

    RETURN v_user_id;
END;
$$;

SELECT public.provision_production_admin_user('Bash@gettaxi.in', 'Basheer', 'MASTER_ADMIN'::user_role);
SELECT public.provision_production_admin_user('santhosh@sgstravels.online', 'Santhosh', 'DISPATCHER'::user_role);
SELECT public.provision_production_admin_user('sathish@quicktaxi.co.in', 'Sathish', 'DISPATCHER'::user_role);
`;
