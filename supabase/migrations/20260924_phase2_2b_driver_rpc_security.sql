-- ==============================================================================
-- SBS TRAVELS — PHASE 2.2B: DRIVER RPC IDENTITY HARDENING
-- Brand: SBS Travels (Powered by Get Taxi Basheer)
-- Backend: Supabase (PostgreSQL)
--
-- Objective:
--   Secure all driver-side SECURITY DEFINER RPCs against driver impersonation
--   by authoritatively verifying that auth.uid() matches drivers.auth_user_id
--   for the provided p_driver_id.
--
-- Domain Identity Rule:
--   auth.users.id (auth.uid()) -> public.drivers.auth_user_id
--   p_driver_id -> public.drivers.id
--   Never compare drivers.id = auth.uid()
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HARDEN CLAIM_TRIP_ATOMIC
-- ------------------------------------------------------------------------------
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

    -- 4. Check Driver Device Authorization
    SELECT * INTO v_device 
    FROM public.driver_devices 
    WHERE driver_id = p_driver_id 
      AND (device_fingerprint = p_device_id OR id::text = p_device_id);

    IF NOT FOUND OR v_device.status != 'ACTIVE' THEN
        -- If no specific device record matches the string, verify driver has an active device registered
        SELECT * INTO v_device 
        FROM public.driver_devices 
        WHERE driver_id = p_driver_id AND status = 'ACTIVE'
        LIMIT 1;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', 'Device is not authorized or inactive for this driver.'
            );
        END IF;
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

-- ------------------------------------------------------------------------------
-- 2. HARDEN MARK_TRIP_ARRIVED
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 3. HARDEN VERIFY_PASSENGER_OTP
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 4. HARDEN START_TRIP_ATOMIC
-- ------------------------------------------------------------------------------
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
    -- 1. Enforce Authenticated Supabase Caller
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Authentication required. Driver must be logged in with an active Supabase session.'
        );
    END IF;

    -- 2. Validate Start PIN
    IF trim(p_start_pin) != v_server_pin THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid Start Meter PIN.');
    END IF;

    -- 3. Authoritatively Verify Caller Identity against drivers.auth_user_id
    SELECT * INTO v_driver 
    FROM public.drivers 
    WHERE id = p_driver_id AND auth_user_id = auth.uid();

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: Driver identity mismatch.');
    END IF;

    IF v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver device not authorized. Status: ' || v_driver.activation_status);
    END IF;

    -- 4. Lock Trip and Validate Status is ARRIVED
    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id AND status = 'ARRIVED'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Trip must be in ARRIVED status before starting meter.');
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

-- ------------------------------------------------------------------------------
-- 5. HARDEN COMPLETE_TRIP_ATOMIC
-- ------------------------------------------------------------------------------
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
