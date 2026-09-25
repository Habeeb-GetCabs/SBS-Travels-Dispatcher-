-- ==============================================================================
-- SBS TRAVELS — SECURE DRIVER PROVISIONING & AUTH BINDING RPC
-- ==============================================================================

-- 1. Function to ensure/bind any driver's auth.users account
CREATE OR REPLACE FUNCTION public.ensure_driver_auth_account(
    p_driver_identifier TEXT,
    p_password TEXT DEFAULT 'SbsTravels@2026!'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
AS $$
DECLARE
    v_clean_id TEXT;
    v_driver RECORD;
    v_email TEXT;
    v_auth_user_id UUID;
BEGIN
    v_clean_id := trim(p_driver_identifier);
    IF v_clean_id = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver identifier is required.');
    END IF;

    -- Match by driver_code, email prefix, or mobile
    SELECT * INTO v_driver
    FROM public.drivers
    WHERE upper(driver_code) = upper(split_part(v_clean_id, '@', 1))
       OR mobile = v_clean_id
       OR upper(driver_code) = upper(v_clean_id)
       OR mobile LIKE '%' || right(regexp_replace(v_clean_id, '[^0-9]', '', 'g'), 10)
    LIMIT 1;

    IF v_driver.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Driver not found: ' || v_clean_id);
    END IF;

    v_email := lower(v_driver.driver_code) || '@sbstravels.com';

    SELECT id INTO v_auth_user_id FROM auth.users WHERE lower(email) = v_email;

    IF v_auth_user_id IS NOT NULL THEN
        UPDATE auth.users
        SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            encrypted_password = crypt(COALESCE(p_password, 'SbsTravels@2026!'), gen_salt('bf')),
            updated_at = NOW()
        WHERE id = v_auth_user_id;
    ELSE
        v_auth_user_id := gen_random_uuid();
        INSERT INTO auth.users (
            id, instance_id, email, encrypted_password, email_confirmed_at,
            aud, role, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at
        ) VALUES (
            v_auth_user_id, '00000000-0000-0000-0000-000000000000', v_email,
            crypt(COALESCE(p_password, 'SbsTravels@2026!'), gen_salt('bf')), NOW(),
            'authenticated', 'authenticated', '{"provider": "email", "providers": ["email"]}'::jsonb,
            jsonb_build_object('full_name', v_driver.name, 'role', 'DRIVER', 'driver_code', v_driver.driver_code),
            false, NOW(), NOW()
        );
    END IF;

    UPDATE public.drivers
    SET auth_user_id = v_auth_user_id, updated_at = NOW()
    WHERE id = v_driver.id;

    INSERT INTO public.driver_devices (driver_id, device_fingerprint, device_model, app_version, status)
    VALUES (v_driver.id, 'DEV-SBS-' || v_driver.driver_code, COALESCE(v_driver.vehicle_model, 'Taxi Mobile'), '2.6', 'ACTIVE')
    ON CONFLICT (driver_id, device_fingerprint) DO UPDATE SET status = 'ACTIVE';

    RETURN jsonb_build_object(
        'success', true,
        'email', v_email,
        'driver_code', v_driver.driver_code,
        'name', v_driver.name,
        'auth_user_id', v_auth_user_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_driver_auth_account(TEXT, TEXT) TO anon, authenticated;

-- 2. Secure Driver Account Provisioning with Automatic Auth Account Creation
CREATE OR REPLACE FUNCTION public.provision_driver_account(
    p_name TEXT,
    p_mobile TEXT,
    p_driver_code TEXT,
    p_vehicle_number TEXT,
    p_vehicle_model TEXT DEFAULT 'Taxi',
    p_operational_status TEXT DEFAULT 'OFFLINE',
    p_activation_status TEXT DEFAULT 'ACTIVE',
    p_auth_user_id UUID DEFAULT NULL,
    p_password TEXT DEFAULT 'SbsTravels@2026!'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
AS $$
DECLARE
    v_new_id UUID;
    v_auth_user_id UUID := p_auth_user_id;
    v_email TEXT;
    v_driver RECORD;
BEGIN
    IF p_name IS NULL OR trim(p_name) = '' OR
       p_mobile IS NULL OR trim(p_mobile) = '' OR
       p_driver_code IS NULL OR trim(p_driver_code) = '' OR
       p_vehicle_number IS NULL OR trim(p_vehicle_number) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Driver name, mobile number, unique code, and vehicle number are required.'
        );
    END IF;

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

    v_email := lower(trim(p_driver_code)) || '@sbstravels.com';
    IF v_auth_user_id IS NULL THEN
        SELECT id INTO v_auth_user_id FROM auth.users WHERE lower(email) = v_email;
    END IF;

    IF v_auth_user_id IS NOT NULL THEN
        UPDATE auth.users
        SET 
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            encrypted_password = crypt(COALESCE(p_password, 'SbsTravels@2026!'), gen_salt('bf')),
            updated_at = NOW()
        WHERE id = v_auth_user_id;
    ELSE
        v_auth_user_id := gen_random_uuid();
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
            v_auth_user_id,
            '00000000-0000-0000-0000-000000000000',
            v_email,
            crypt(COALESCE(p_password, 'SbsTravels@2026!'), gen_salt('bf')),
            NOW(),
            'authenticated',
            'authenticated',
            '{"provider": "email", "providers": ["email"]}'::jsonb,
            jsonb_build_object('full_name', trim(p_name), 'role', 'DRIVER', 'driver_code', upper(trim(p_driver_code))),
            false,
            NOW(),
            NOW()
        );
    END IF;

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
        v_auth_user_id,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_new_id;

    INSERT INTO public.driver_devices (driver_id, device_fingerprint, device_model, app_version, status)
    VALUES (v_new_id, 'DEV-SBS-' || upper(trim(p_driver_code)), COALESCE(trim(p_vehicle_model), 'Taxi Mobile'), '2.6', 'ACTIVE')
    ON CONFLICT (driver_id, device_fingerprint) DO UPDATE SET status = 'ACTIVE';

    SELECT * INTO v_driver FROM public.drivers WHERE id = v_new_id;

    RETURN jsonb_build_object(
        'success', true,
        'loginEmail', v_email,
        'loginPassword', COALESCE(p_password, 'SbsTravels@2026!'),
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

GRANT EXECUTE ON FUNCTION public.provision_driver_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated, anon;

-- Auto-provision/bind auth accounts for any existing drivers in public.drivers with NULL auth_user_id
DO $$
DECLARE
    r RECORD;
    v_res JSONB;
BEGIN
    FOR r IN SELECT driver_code FROM public.drivers LOOP
        v_res := public.ensure_driver_auth_account(r.driver_code, 'SbsTravels@2026!');
    END LOOP;
END $$;
