-- ==============================================================================
-- SBS TRAVELS — SECURE DRIVER PROVISIONING RPC
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.provision_driver_account(
    p_name TEXT,
    p_mobile TEXT,
    p_driver_code TEXT,
    p_vehicle_number TEXT,
    p_vehicle_model TEXT,
    p_operational_status TEXT,
    p_activation_status TEXT,
    p_auth_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_role user_role;
    v_new_id UUID;
    v_driver RECORD;
BEGIN
    -- 1. Enforce Authenticated Supabase Caller
    IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Authentication required. Dispatcher must be logged in.'
        );
    END IF;

    -- 2. Verify Caller Role in public.admin_users
    SELECT role INTO v_role 
    FROM public.admin_users 
    WHERE id = auth.uid();

    IF NOT FOUND OR v_role NOT IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'::user_role) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Unauthorized: Only MASTER_ADMIN or DISPATCHER can provision driver accounts.'
        );
    END IF;

    -- 3. Validate input parameters
    IF p_name IS NULL OR trim(p_name) = '' OR
       p_mobile IS NULL OR trim(p_mobile) = '' OR
       p_driver_code IS NULL OR trim(p_driver_code) = '' OR
       p_vehicle_number IS NULL OR trim(p_vehicle_number) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Driver name, mobile number, unique code, and vehicle number are required.'
        );
    END IF;

    -- 4. Prevent duplicate mobile or driver code
    IF EXISTS (SELECT 1 FROM public.drivers WHERE mobile = trim(p_mobile)) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Duplicate error: A driver with mobile number ' || trim(p_mobile) || ' already exists.'
        );
    END IF;

    IF EXISTS (SELECT 1 FROM public.drivers WHERE driver_code = upper(trim(p_driver_code))) THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Duplicate error: Driver code ' || upper(trim(p_driver_code)) || ' is already assigned.'
        );
    END IF;

    -- 5. Atomic Insertion into drivers table
    INSERT INTO public.drivers (
        name,
        mobile,
        driver_code,
        vehicle_number,
        vehicle_model,
        operational_status,
        activation_status,
        auth_user_id,
        created_at,
        updated_at
    ) VALUES (
        trim(p_name),
        trim(p_mobile),
        upper(trim(p_driver_code)),
        upper(trim(p_vehicle_number)),
        COALESCE(trim(p_vehicle_model), 'Taxi'),
        COALESCE(p_operational_status, 'OFFLINE')::driver_operational_status,
        COALESCE(p_activation_status, 'ACTIVE')::device_activation_status,
        p_auth_user_id,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_new_id;

    -- 6. Insert into audit logs
    INSERT INTO public.audit_logs (event_type, actor_id, target_id, details)
    VALUES (
        'DRIVER_PROVISIONED',
        auth.uid(),
        v_new_id,
        jsonb_build_object(
            'driver_code', upper(trim(p_driver_code)),
            'mobile', trim(p_mobile)
        )
    );

    -- 7. Fetch the created record to return to dispatcher
    SELECT * INTO v_driver FROM public.drivers WHERE id = v_new_id;

    RETURN jsonb_build_object(
        'success', true,
        'driver', jsonb_build_object(
            'id', v_driver.id,
            'authUserId', v_driver.auth_user_id,
            'driverCode', v_driver.driver_code,
            'name', v_driver.name,
            'mobile', v_driver.mobile,
            'vehicleNumber', v_driver.vehicle_number,
            'vehicleModel', v_driver.vehicle_model,
            'operationalStatus', v_driver.operational_status,
            'activationStatus', v_driver.activation_status,
            'deviceId', 'DEV-SBS-' || v_driver.driver_code,
            'created_at', v_driver.created_at,
            'updated_at', v_driver.updated_at
        )
    );
END;
$$;

-- Revoke default execute from public/anon and grant execute to authenticated
REVOKE EXECUTE ON FUNCTION public.provision_driver_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_driver_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;
