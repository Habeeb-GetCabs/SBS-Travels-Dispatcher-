-- ==============================================================================
-- SBS TRAVELS — PHASE 2.6 SECURITY HARDENING MIGRATION
-- ==============================================================================

-- 1. Ensure public.trips has a start_pin column
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS start_pin TEXT;

-- 2. Populate existing trips with a random 4-digit start PIN if null
UPDATE public.trips 
SET start_pin = floor(1000 + random() * 9000)::text 
WHERE start_pin IS NULL;

-- 3. Hardened Atomic Trip Claim RPC (Strict device verification, no fallback)
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

-- 4. Hardened Trip Start RPC (Authoritative Trip-Specific PIN validation)
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

-- 5. Add INSERT policy on public.driver_devices for dispatchers/admins
DROP POLICY IF EXISTS "Dispatchers can insert driver devices" ON public.driver_devices;
CREATE POLICY "Dispatchers can insert driver devices"
ON public.driver_devices FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL 
    AND auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'))
);

-- 6. Database Enforced Single Active Device per Driver Trigger
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
