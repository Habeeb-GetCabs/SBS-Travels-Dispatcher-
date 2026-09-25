-- ==============================================================================
-- SBS TRAVELS — PHASE 2.1 SECURITY LOCKDOWN MIGRATION
-- Brand: SBS Travels (Powered by Get Taxi Basheer)
-- Backend: Supabase (PostgreSQL)
-- Objectives:
--   1. Eliminate permissive RLS on public.trips (disallow viewing other drivers' trips)
--   2. Restrict public.trips INSERT to authorized dispatchers/admins
--   3. Revoke direct INSERT on public.completed_trips and enforce complete_trip_atomic RPC
--   4. Harden complete_trip_atomic with driver activation, ownership, and STARTED state gates
--   5. Secure drivers, driver_devices, trip_claims, and audit_logs tables
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HARDEN TRIPS RLS (SELECT & INSERT)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Drivers and dispatchers can view open or claimed trips" ON public.trips;
DROP POLICY IF EXISTS "Dispatcher trip creation" ON public.trips;
DROP POLICY IF EXISTS "Authorized drivers can view open or own trips" ON public.trips;
DROP POLICY IF EXISTS "Authorized dispatchers can create trips" ON public.trips;

-- Narrow SELECT: Authenticated registered driver can view OPEN trips or only trips claimed by their authenticated profile
-- Dispatchers/admins can view all trips. Unauthenticated (anon) callers and unauthorized authenticated users are strictly denied.
CREATE POLICY "Authorized drivers can view open or own trips"
ON public.trips FOR SELECT
TO authenticated
USING (
    -- Authenticated registered driver can read OPEN trips to see available dispatch offers
    (status = 'OPEN' AND auth.uid() IN (SELECT auth_user_id FROM public.drivers WHERE auth_user_id IS NOT NULL))
    -- An authenticated driver can only read trips assigned to their driver profile
    OR (
        auth.uid() IS NOT NULL 
        AND claimed_by_driver_id IN (
            SELECT id FROM public.drivers WHERE auth_user_id = auth.uid()
        )
    )
    -- Authenticated dispatchers and admins can inspect all trips
    OR (
        auth.uid() IS NOT NULL 
        AND auth.uid() IN (
            SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')
        )
    )
);

-- Strict INSERT: Restrict direct trip creation to verified dispatchers/admins
CREATE POLICY "Authorized dispatchers can create trips"
ON public.trips FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL 
    AND auth.uid() IN (
        SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')
    )
);

-- Ensure RLS is active on trips
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. HARDEN COMPLETED_TRIPS (REVOKE DIRECT INSERT & HARDEN SELECT)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow completed trip recording" ON public.completed_trips;
DROP POLICY IF EXISTS "Drivers and dispatchers can view completed trips" ON public.completed_trips;
DROP POLICY IF EXISTS "Drivers view own completed trips and dispatchers view all" ON public.completed_trips;

-- Revoke direct INSERT privileges from public/anon/authenticated roles
-- All inserts MUST flow through the SECURITY DEFINER RPC complete_trip_atomic
REVOKE INSERT ON public.completed_trips FROM anon, authenticated, public;

-- Strict SELECT: Authenticated drivers can only view their own receipts; dispatchers view all
CREATE POLICY "Drivers view own completed trips and dispatchers view all"
ON public.completed_trips FOR SELECT
TO authenticated
USING (
    (
        auth.uid() IS NOT NULL 
        AND driver_id IN (
            SELECT id FROM public.drivers WHERE auth_user_id = auth.uid()
        )
    )
    OR (
        auth.uid() IS NOT NULL 
        AND auth.uid() IN (
            SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')
        )
    )
);

-- Ensure RLS is active on completed_trips
ALTER TABLE public.completed_trips ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. HARDEN ADMIN USERS, DRIVERS & DRIVER DEVICES RLS
-- ------------------------------------------------------------------------------
-- Admin Users Policy: Allow authenticated user to view their own admin profile
DROP POLICY IF EXISTS "Admin users can view own profile" ON public.admin_users;
CREATE POLICY "Admin users can view own profile"
ON public.admin_users FOR SELECT
TO authenticated
USING (
    id = auth.uid()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers can view driver directory" ON public.drivers;
DROP POLICY IF EXISTS "Drivers can view own profile or dispatchers view all" ON public.drivers;

CREATE POLICY "Drivers can view own profile or dispatchers view all"
ON public.drivers FOR SELECT
TO authenticated
USING (
    -- Driver can view their own record
    (auth.uid() IS NOT NULL AND auth_user_id = auth.uid())
    -- Dispatchers/admins can view all driver records
    OR (auth.uid() IS NOT NULL AND auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER')))
);

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- Driver devices policy
DROP POLICY IF EXISTS "Drivers and dispatchers view devices" ON public.driver_devices;
CREATE POLICY "Drivers and dispatchers view devices"
ON public.driver_devices FOR SELECT
TO authenticated
USING (
    driver_id IN (SELECT id FROM public.drivers WHERE auth_user_id = auth.uid())
    OR auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'))
);

ALTER TABLE public.driver_devices ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 4. HARDEN TRIP CLAIMS & AUDIT LOGS
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Dispatchers can view claim logs" ON public.trip_claims;
CREATE POLICY "Dispatchers can view claim logs"
ON public.trip_claims FOR SELECT
TO authenticated
USING (
    auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'))
);

ALTER TABLE public.trip_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dispatchers can view audit logs" ON public.audit_logs;
CREATE POLICY "Dispatchers can view audit logs"
ON public.audit_logs FOR SELECT
TO authenticated
USING (
    auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'))
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 5. VERIFY & HARDEN COMPLETE_TRIP_ATOMIC RPC
--   - Verifies active driver status
--   - Verifies trip ownership
--   - Verifies trip status is STARTED (blocks completing non-started trips)
--   - Idempotent against duplicate completion attempts
--   - Enforces search_path = public and SECURITY DEFINER
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
    -- 1. Validate Driver and Activation Status
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND OR v_driver.activation_status != 'ACTIVE' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized or inactive driver.'
        );
    END IF;

    -- 2. Lock and Validate Trip Ownership
    SELECT * INTO v_trip FROM public.trips 
    WHERE id = p_trip_id AND claimed_by_driver_id = p_driver_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Trip record not found or not assigned to driver.'
        );
    END IF;

    -- 3. Idempotency: If already finalized, return success safely
    IF v_trip.status = 'COMPLETED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'trip_id', p_trip_id,
            'status', 'COMPLETED',
            'message', 'Trip already finalized and completed.'
        );
    END IF;

    -- 4. Strictly Enforce Current Status is STARTED
    IF v_trip.status != 'STARTED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Trip must be in STARTED status before completion. Current status: ' || v_trip.status
        );
    END IF;

    v_total := COALESCE((p_summary->>'totalFare')::numeric, 0);

    -- 5. Authoritatively Transition Trip to COMPLETED
    UPDATE public.trips
    SET 
        status = 'COMPLETED',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trip_id;

    -- 6. Authoritatively Reset Driver Operational Status to READY
    UPDATE public.drivers
    SET 
        operational_status = 'READY',
        updated_at = NOW()
    WHERE id = p_driver_id;

    -- 7. Insert Itemized Completed Trip Record (Unique on trip_id)
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

    -- 8. Write Audit Trail Entry
    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES (
        'TRIP_COMPLETED',
        p_driver_id,
        p_trip_id,
        jsonb_build_object('totalFare', v_total, 'completed_at', NOW())
    );

    RETURN jsonb_build_object(
        'success', true,
        'trip_id', p_trip_id,
        'status', 'COMPLETED',
        'totalFare', v_total
    );
END;
$$;

-- Grant execution to authenticated and anon users
GRANT EXECUTE ON FUNCTION public.complete_trip_atomic(UUID, UUID, JSONB) TO authenticated, anon;
