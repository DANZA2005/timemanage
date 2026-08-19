import { supabase } from '@/src/lib/supabase';
import { storage } from '@/src/utils/storage';

export const ROLE_KEY = 'tg_role';
export const DEV_ID = 'tg_dev_id';
export const DEV_FAMILY = 'tg_dev_family';
export const DEV_PROFILE = 'tg_dev_profile';
export const DEV_TYPE = 'tg_dev_type';

export type Role = 'parent' | 'monitored' | null;
export type MonitoredDevice = { deviceId: string; familyId: string; profileName: string; profileType: string };

export function randomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function getRole(): Promise<Role> {
  return (await storage.getItem(ROLE_KEY, '')) as Role;
}

export async function getMonitoredDevice(): Promise<MonitoredDevice | null> {
  const deviceId = await storage.getItem(DEV_ID, '');
  if (!deviceId) return null;
  return {
    deviceId,
    familyId: (await storage.getItem(DEV_FAMILY, '')) || '',
    profileName: (await storage.getItem(DEV_PROFILE, '')) || 'Perfil',
    profileType: (await storage.getItem(DEV_TYPE, '')) || 'nino',
  };
}

export async function createPairingCode(
  familyId: string,
  opts: { deviceName: string; profileName: string; profileType: string; ttlMinutes?: number },
) {
  const code = randomCode();
  const expires = new Date(Date.now() + (opts.ttlMinutes ?? 10) * 60000).toISOString();
  const { data, error } = await supabase
    .from('pairing_codes')
    .insert({ family_id: familyId, code, device_name: opts.deviceName, profile_name: opts.profileName, profile_type: opts.profileType, expires_at: expires })
    .select('code,expires_at')
    .single();
  return { data, error };
}

export async function redeemCode(code: string): Promise<{ data?: MonitoredDevice; error?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  if (!sess.session) {
    const anon = await supabase.auth.signInAnonymously();
    if (anon.error) {
      return { error: 'No se pudo iniciar sesión anónima. Activa "Anonymous sign-ins" en Supabase (Authentication → Providers).' };
    }
  }
  const { data, error } = await supabase.rpc('redeem_pairing_code', { p_code: code.trim().toUpperCase() });
  if (error) {
    const map: Record<string, string> = {
      CODE_NOT_FOUND: 'Código no encontrado. Revísalo e inténtalo de nuevo.',
      CODE_USED: 'Este código ya fue usado en otro dispositivo.',
      CODE_EXPIRED: 'El código ha caducado. Pide uno nuevo al padre/madre.',
    };
    const key = Object.keys(map).find((k) => error.message.includes(k));
    return { error: key ? map[key] : error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  const dev: MonitoredDevice = { deviceId: row.device_id, familyId: row.family_id, profileName: row.profile_name, profileType: row.profile_type };
  await storage.setItem(ROLE_KEY, 'monitored');
  await storage.setItem(DEV_ID, dev.deviceId);
  await storage.setItem(DEV_FAMILY, dev.familyId);
  await storage.setItem(DEV_PROFILE, dev.profileName);
  await storage.setItem(DEV_TYPE, dev.profileType);
  return { data: dev };
}

export async function setParentRole() {
  await storage.setItem(ROLE_KEY, 'parent');
}

export async function clearRole() {
  await storage.removeItem(ROLE_KEY);
  await storage.removeItem(DEV_ID);
  await storage.removeItem(DEV_FAMILY);
  await storage.removeItem(DEV_PROFILE);
  await storage.removeItem(DEV_TYPE);
}

export const PROFILE_TYPES: { key: string; label: string; icon: string }[] = [
  { key: 'nino', label: 'Niño/a', icon: 'happy-outline' },
  { key: 'adolescente', label: 'Adolescente', icon: 'person-outline' },
  { key: 'personalizado', label: 'Personalizado', icon: 'construct-outline' },
];

export function profileTypeLabel(key: string) {
  return PROFILE_TYPES.find((t) => t.key === key)?.label || 'Perfil';
}
