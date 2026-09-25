-- ==============================================================================
-- SBS TRAVELS — REAL PRODUCTION ADMIN & DISPATCHER ACCOUNTS PROVISIONING
-- ==============================================================================

-- 1. Ensure user_role enum exists
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER', 'DRIVER');
    END IF;
END $$;

-- 2. Ensure admin_users table exists with correct RLS
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'DISPATCHER',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Select Policy for authenticated users to view own profile or admins to view all
DROP POLICY IF EXISTS "Admin users can view own profile" ON public.admin_users;
CREATE POLICY "Admin users can view own profile"
ON public.admin_users FOR SELECT
TO authenticated
USING (
    id = auth.uid() OR auth.uid() IN (SELECT id FROM public.admin_users WHERE role IN ('MASTER_ADMIN', 'ADMIN', 'DISPATCHER'))
);

-- 3. FUNCTION TO PROVISION PRODUCTION STAFF ACCOUNT IN AUTH.USERS AND ADMIN_USERS
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
    -- Check if auth user already exists in auth.users
    SELECT id INTO v_existing_auth_id
    FROM auth.users
    WHERE LOWER(email) = LOWER(p_email);

    IF v_existing_auth_id IS NOT NULL THEN
        v_user_id := v_existing_auth_id;
        -- Ensure email is confirmed and password set
        UPDATE auth.users
        SET 
            email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
            encrypted_password = crypt(p_password, gen_salt('bf')),
            updated_at = NOW()
        WHERE id = v_user_id;
    ELSE
        -- Create new auth.users record
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

    -- Upsert public.admin_users record
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

-- 4. PROVISION THE 3 PRODUCTION ACCOUNTS
SELECT public.provision_production_admin_user('Bash@gettaxi.in', 'Basheer', 'MASTER_ADMIN'::user_role);
SELECT public.provision_production_admin_user('santhosh@sgstravels.online', 'Santhosh', 'DISPATCHER'::user_role);
SELECT public.provision_production_admin_user('sathish@quicktaxi.co.in', 'Sathish', 'DISPATCHER'::user_role);
