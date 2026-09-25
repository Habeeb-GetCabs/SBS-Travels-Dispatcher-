-- ==============================================================================
-- SBS TRAVELS — PHASE 2 MIGRATION: PASSENGER VERIFICATION OTP & DRIVER MONITORING
-- Brand: SBS Travels (Powered by Get Taxi Basheer)
-- Backend: Supabase (PostgreSQL)
-- ==============================================================================

-- 1. ADD PASSENGER VERIFICATION OTP COLUMNS TO TRIPS TABLE
ALTER TABLE public.trips
    ADD COLUMN IF NOT EXISTS passenger_otp_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS passenger_verification_otp TEXT,
    ADD COLUMN IF NOT EXISTS passenger_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS passenger_verification_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS passenger_verification_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED';

-- Add check constraint for passenger verification status
DO $$
BEGIN
    ALTER TABLE public.trips 
        ADD CONSTRAINT check_passenger_otp_status 
        CHECK (passenger_verification_status IN ('NOT_REQUIRED', 'PENDING', 'VERIFIED', 'FAILED_BLOCKED'));
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. UPDATE DRIVERS OPERATIONAL STATUS ENUM/VALUES TO COVER EXPANDED LIFECYCLE
-- (READY, OFFLINE, TRIP_CLAIMED, ARRIVED, ON_TRIP, COMPLETING, AVAILABLE, SUSPENDED)
DO $$
BEGIN
    -- If operational_status is a column with text or enum, allow full lifecycle states
    ALTER TABLE public.drivers ALTER COLUMN operational_status TYPE TEXT;
EXCEPTION
    WHEN others THEN null;
END $$;

-- 3. SECURE SERVER-AUTHORITATIVE RPC: VERIFY PASSENGER OTP
-- Validates passenger verification OTP provided by passenger to driver at pickup
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
    -- 1. Validate Driver
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND OR v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized or inactive driver.');
    END IF;

    -- 2. Lock Trip and Validate Status is ARRIVED
    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip record not found or not assigned to driver.');
    END IF;

    IF v_trip.status != 'ARRIVED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip must be in ARRIVED status to verify passenger OTP.');
    END IF;

    -- Check if OTP is actually required
    IF v_trip.passenger_otp_required = FALSE THEN
        RETURN jsonb_build_object('success', true, 'message', 'Passenger verification not required for this trip.', 'status', 'NOT_REQUIRED');
    END IF;

    -- Check if already verified
    IF v_trip.passenger_verification_status = 'VERIFIED' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Passenger already verified.', 'status', 'VERIFIED');
    END IF;

    -- Check for brute-force lock (max 5 attempts)
    IF v_trip.passenger_verification_attempts >= 5 THEN
        UPDATE public.trips 
        SET passenger_verification_status = 'FAILED_BLOCKED', updated_at = NOW()
        WHERE id = p_trip_id;

        RETURN jsonb_build_object(
            'success', false, 
            'message', 'Maximum OTP verification attempts exceeded. Verification blocked. Contact dispatch.',
            'status', 'FAILED_BLOCKED'
        );
    END IF;

    -- Compare OTP (trimmed)
    IF trim(p_otp) = trim(v_trip.passenger_verification_otp) THEN
        -- Successful verification
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
        -- Failed attempt: Increment counter
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

-- 4. UPDATE START TRIP ATOMIC RPC TO ENFORCE PASSENGER OTP GATE
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
    v_server_pin CONSTANT TEXT := '2481'; -- Authoritative Driver Start Meter PIN
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

    -- 4. Enforce Passenger Verification Gate if Required
    IF v_trip.passenger_otp_required = TRUE AND v_trip.passenger_verification_status != 'VERIFIED' THEN
        RETURN jsonb_build_object(
            'success', false, 
            'message', 'Passenger Verification OTP must be verified before starting the meter.'
        );
    END IF;

    -- 5. Validate Tariff Configuration Exists
    IF v_trip.tariff_config IS NULL OR v_trip.tariff_config = '{}'::jsonb THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip has missing tariff configuration. Please contact dispatch.');
    END IF;

    -- 6. Transition to STARTED
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

-- 5. UPDATE MARK TRIP ARRIVED RPC TO SET DRIVER STATUS TO 'ARRIVED'
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

-- 6. UPDATE CLAIM TRIP ATOMIC TO SET DRIVER STATUS TO 'TRIP_CLAIMED'
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

    -- 2. Find and Lock Open Trip
    SELECT * INTO v_trip 
    FROM public.trips 
    WHERE trip_access_otp = trim(p_access_otp) 
      AND is_otp_consumed = FALSE 
      AND status = 'OPEN'
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT * INTO v_trip FROM public.trips WHERE trip_access_otp = trim(p_access_otp);
        IF FOUND THEN
            INSERT INTO public.trip_claims (trip_id, driver_id, claim_status)
            VALUES (v_trip.id, p_driver_id, 'COLLISION_REJECTED');

            RETURN jsonb_build_object('success', false, 'message', 'Trip already claimed by another driver.');
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Invalid Trip Access OTP. Please check with dispatch.');
        END IF;
    END IF;

    -- 3. Atomic Assignment
    UPDATE public.trips
    SET 
        status = 'CLAIMED',
        claimed_by_driver_id = p_driver_id,
        claimed_at = NOW(),
        is_otp_consumed = TRUE,
        updated_at = NOW()
    WHERE id = v_trip.id;

    -- Update driver status to TRIP_CLAIMED
    UPDATE public.drivers
    SET operational_status = 'TRIP_CLAIMED', updated_at = NOW()
    WHERE id = p_driver_id;

    INSERT INTO public.trip_claims (trip_id, driver_id, claim_status)
    VALUES (v_trip.id, p_driver_id, 'WON');

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
        'passenger_otp_required', v_trip.passenger_otp_required,
        'passenger_verification_status', v_trip.passenger_verification_status,
        'status', 'CLAIMED'
    );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.verify_passenger_otp TO authenticated, anon;
