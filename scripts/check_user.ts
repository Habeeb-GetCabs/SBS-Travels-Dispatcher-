import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://htxrmlqcfnauuuutlzjb.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkUser() {
  console.log('Testing RPC call provision_production_admin_user...');
  try {
    const { data, error } = await supabase.rpc('provision_production_admin_user', {
      p_email: 'Bashdrives@gmail.com',
      p_full_name: 'Basheer',
      p_role: 'MASTER_ADMIN',
      p_password: 'Basheer2481'
    });
    
    if (error) {
      console.log('RPC Call returned an error:', error.message, error.code);
    } else {
      console.log('RPC Call succeeded! Result:', data);
    }
  } catch (err: any) {
    console.error('Exception calling RPC:', err.message);
  }
}

checkUser();
