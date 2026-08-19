import { requireOptionalNativeModule } from 'expo-modules-core';

import { supabase } from '@/src/lib/supabase';

export type AppUsage = { packageName: string; appName: string; minutes: number };

type NativeUsage = {
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): void;
  getUsage(sinceMs: number): Promise<AppUsage[]>;
  getInstalledApps(): Promise<{ packageName: string; appName: string }[]>;
  isAccessibilityEnabled(): boolean;
  openAccessibilitySettings(): void;
  setBlocking(enabled: boolean, allowedPackages: string[]): void;
};

// null on Expo Go / web (module not compiled in) — everything degrades gracefully.
const native = requireOptionalNativeModule<NativeUsage>('TimeguardUsage');

export const usageAvailable = native != null;

export function hasUsageAccess(): boolean {
  return native ? native.hasUsageAccess() : false;
}
export function openUsageAccessSettings() {
  native?.openUsageAccessSettings();
}
export async function getUsage(sinceMs: number): Promise<AppUsage[]> {
  return native ? native.getUsage(sinceMs) : [];
}
export async function getInstalledApps(): Promise<{ packageName: string; appName: string }[]> {
  return native ? native.getInstalledApps() : [];
}
export function isAccessibilityEnabled(): boolean {
  return native ? native.isAccessibilityEnabled() : false;
}
export function openAccessibilitySettings() {
  native?.openAccessibilitySettings();
}
export function setBlocking(enabled: boolean, allowedPackages: string[] = []) {
  native?.setBlocking(enabled, allowedPackages);
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Reads today's real usage from Android and syncs it to Supabase for this device.
export async function syncUsageToSupabase(deviceId: string): Promise<{ total: number; apps: number } | null> {
  if (!native) return null;
  const apps = await getUsage(startOfToday());
  const today = new Date().toISOString().slice(0, 10);
  const total = apps.reduce((s, a) => s + a.minutes, 0);

  // Refresh today's per-app breakdown.
  await supabase.from('app_usage').delete().eq('device_id', deviceId).eq('usage_date', today);
  if (apps.length) {
    await supabase.from('app_usage').insert(apps.map((a) => ({ device_id: deviceId, app_name: a.appName, package_name: a.packageName, minutes: a.minutes, usage_date: today })));
  }

  // Keep a single session row representing today's total minutes.
  const startIso = new Date(startOfToday()).toISOString();
  const existing = await supabase.from('device_sessions').select('id').eq('device_id', deviceId).gte('started_at', startIso).limit(1).maybeSingle();
  if (existing.data) await supabase.from('device_sessions').update({ duration_minutes: total, ended_at: new Date().toISOString() }).eq('id', existing.data.id);
  else await supabase.from('device_sessions').insert({ device_id: deviceId, started_at: startIso, ended_at: new Date().toISOString(), duration_minutes: total });

  return { total, apps: apps.length };
}

// Populate managed_apps with the device's launchable apps (does not overwrite existing allow flags).
export async function syncInstalledApps(deviceId: string): Promise<number> {
  if (!native) return 0;
  const apps = await getInstalledApps();
  if (!apps.length) return 0;
  const rows = apps.map((a) => ({ device_id: deviceId, app_name: a.appName, package_name: a.packageName, allowed: true }));
  await supabase.from('managed_apps').upsert(rows, { onConflict: 'device_id,app_name', ignoreDuplicates: true });
  return apps.length;
}

// Package names that stay usable while the device is blocked.
export async function getAllowedPackages(deviceId: string): Promise<string[]> {
  const { data } = await supabase.from('managed_apps').select('package_name,allowed').eq('device_id', deviceId).eq('allowed', true);
  return (data || []).map((r) => r.package_name).filter((p): p is string => !!p);
}
