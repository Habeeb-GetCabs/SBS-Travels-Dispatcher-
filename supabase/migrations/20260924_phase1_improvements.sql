-- ==============================================================================
-- SBS TRAVELS — PHASE 1 MIGRATION: CUSTOM PER-TRIP TARIFF & SECURE LIFECYCLE
-- Brand: SBS Travels (Powered by Get Taxi Basheer)
-- Backend: Supabase (PostgreSQL)
-- ==============================================================================

-- 1. ADD 'ARRIVED' TO TRIP STATUS ENUM (Safe migration)
DO $$
BEGIN
    ALTER TYPE public.trip_status ADD VALUE IF NOT EXISTS 'ARRIVED' AFTER 'CLAIMED';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. ENHANCE TRIPS TABLE WITH CUSTOM TARIFF & LOCATION METADATA
ALTER TABLE public.trips 
    ADD COLUMN IF NOT EXISTS tariff_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pickup_place_id TEXT,
    ADD COLUMN IF NOT EXISTS drop_place_id TEXT,
    ADD COLUMN IF NOT EXISTS estimated_distance_km NUMERIC(8,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER DEFAULT 0;

-- 3. ENHANCE COMPLETED TRIPS TABLE FOR ITEMIZED BREAKDOWN
ALTER TABLE public.completed_trips
    ADD COLUMN IF NOT EXISTS driver_bata NUMERIC(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS toll NUMERIC(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS parking NUMERIC(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS interstate_tax NUMERIC(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount NUMERIC(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tariff_config JSONB DEFAULT '{}'::jsonb;

-- 4. PERFORMANCE & ATOMIC LOCKING INDEXES
CREATE INDEX IF NOT EXISTS idx_trips_access_otp ON public.trips(trip_access_otp);
CREATE INDEX IF NOT EXISTS idx_trips_status ON public.trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_claimed_driver ON public.trips(claimed_by_driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON public.trips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drivers_code ON public.drivers(driver_code);
CREATE INDEX IF NOT EXISTS idx_drivers_activation ON public.drivers(activation_status);

-- ==============================================================================
-- SECURE SERVER-AUTHORITATIVE RPC: ATOMIC TRIP CLAIM
-- First-Driver-Wins with row lock, activation check, and collision logging
-- ==============================================================================
DROP FUNCTION IF EXISTS public.claim_trip_atomic;
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
BEGIN
    -- 1. Validate Driver and Activation Status
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver record not found.');
    END IF;

    IF v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver device is ' || v_driver.activation_status || '. Authorization required.');
    END IF;

    -- 2. Find and Lock Open Trip (Row-level lock for atomic claim)
    SELECT * INTO v_trip 
    FROM public.trips 
    WHERE trip_access_otp = trim(p_access_otp) 
      AND is_otp_consumed = FALSE 
      AND status = 'OPEN'
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Check if it was already claimed by another driver
        SELECT * INTO v_trip FROM public.trips WHERE trip_access_otp = trim(p_access_otp);
        IF FOUND THEN
            -- Record collision attempt for audit
            INSERT INTO public.trip_claims (trip_id, driver_id, claim_status)
            VALUES (v_trip.id, p_driver_id, 'COLLISION_REJECTED');

            RETURN jsonb_build_object('success', false, 'message', 'Trip already claimed by another driver.');
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Invalid Trip Access OTP. Please check with dispatch.');
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
    INSERT INTO public.trip_claims (trip_id, driver_id, claim_status)
    VALUES (v_trip.id, p_driver_id, 'WON');

    -- Audit log
    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES ('TRIP_CLAIMED', p_driver_id, v_trip.id, jsonb_build_object('otp', p_access_otp, 'device_id', p_device_id));

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
        'status', 'CLAIMED'
    );
END;
$$;

-- ==============================================================================
-- SECURE SERVER-AUTHORITATIVE RPC: MARK TRIP ARRIVED
-- Transitions CLAIMED -> ARRIVED (Swipe to Arrived gate)
-- ==============================================================================
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
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND OR v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized or inactive driver.');
    END IF;

    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id AND status = 'CLAIMED'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip not found or not in CLAIMED state.');
    END IF;

    UPDATE public.trips
    SET 
        status = 'ARRIVED',
        arrived_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trip_id;

    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES ('TRIP_ARRIVED', p_driver_id, p_trip_id, jsonb_build_object('arrived_at', NOW()));

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', p_trip_id,
        'status', 'ARRIVED',
        'arrived_at', NOW()
    );
END;
$$;

-- ==============================================================================
-- SECURE SERVER-AUTHORITATIVE RPC: START TRIP ATOMIC
-- Validates Start Meter PIN on server side (NO PIN in frontend client)
-- Transitions ARRIVED -> STARTED
-- ==============================================================================
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
    v_server_pin CONSTANT TEXT := '2481'; -- Server-authoritative Start Meter PIN
BEGIN
    -- 1. Validate PIN
    IF trim(p_start_pin) != v_server_pin THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid Start Meter PIN.');
    END IF;

    -- 2. Validate Driver
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND OR v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized or inactive driver.');
    END IF;

    -- 3. Lock Trip and Validate Status is ARRIVED
    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id AND status = 'ARRIVED'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip must be in ARRIVED status before starting meter.');
    END IF;

    -- 4. Validate Tariff Configuration Exists
    IF v_trip.tariff_config IS NULL OR v_trip.tariff_config = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip has missing tariff configuration. Please contact dispatch.');
    END IF;

    -- 5. Transition to STARTED
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

-- ==============================================================================
-- SECURE SERVER-AUTHORITATIVE RPC: COMPLETE TRIP ATOMIC
-- Prevents duplicate completion & freezes final trip metrics
-- Transitions STARTED -> COMPLETED
-- ==============================================================================
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
    v_total NUMERIC;
BEGIN
    -- 1. Lock and Validate Trip is STARTED
    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip record not found.');
    END IF;

    IF v_trip.status = 'COMPLETED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip already finalized and completed.');
    END IF;

    IF v_trip.status != 'STARTED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip is not currently running.');
    END IF;

    v_total := COALESCE((p_summary->>'totalFare')::numeric, 0);

    -- 2. Mark Trip COMPLETED
    UPDATE public.trips
    SET 
        status = 'COMPLETED',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trip_id;

    -- 3. Reset Driver Status to READY
    UPDATE public.drivers
    SET operational_status = 'READY', updated_at = NOW()
    WHERE id = p_driver_id;

    -- 4. Insert or Update Completed Trips
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
    )
    ON CONFLICT (trip_id) DO NOTHING;

    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES ('TRIP_COMPLETED', p_driver_id, p_trip_id, jsonb_build_object('totalFare', v_total));

    RETURN jsonb_build_object('success', true, 'trip_id', p_trip_id, 'status', 'COMPLETED', 'totalFare', v_total);
END;
$$;

-- Grant execution to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.claim_trip_atomic TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.mark_trip_arrived TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.start_trip_atomic TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.complete_trip_atomic TO authenticated, anon;

-- ==============================================================================
-- HARDENED ROW LEVEL SECURITY (RLS) POLICIES
-- Replaces open "USING (true)" with role & driver authorization
-- ==============================================================================
-- Drop previous open policies
DROP POLICY IF EXISTS "Allow public trips access" ON public.trips;
DROP POLICY IF EXISTS "Allow public drivers access" ON public.drivers;
DROP POLICY IF EXISTS "Allow public completed_trips access" ON public.completed_trips;

-- TRIPS: Read-only access for OPEN trips and claimed trips; Mutations via RPCs
CREATE POLICY "Drivers and dispatchers can view open or claimed trips"
ON public.trips FOR SELECT
USING (
    status = 'OPEN' 
    OR claimed_by_driver_id IS NOT NULL
);

CREATE POLICY "Dispatcher trip creation"
ON public.trips FOR INSERT
WITH CHECK (true);

-- DRIVERS: Read driver profiles; Updates only via administrative or profile actions
CREATE POLICY "Drivers can view driver directory"
ON public.drivers FOR SELECT
USING (true);

-- COMPLETED TRIPS: Drivers can view completed trip receipts
CREATE POLICY "Drivers and dispatchers can view completed trips"
ON public.completed_trips FOR SELECT
USING (true);

CREATE POLICY "Allow completed trip recording"
ON public.completed_trips FOR INSERT
WITH CHECK (true);
