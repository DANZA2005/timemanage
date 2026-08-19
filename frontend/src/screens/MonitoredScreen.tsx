import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';

import { clearRole, MonitoredDevice, profileTypeLabel } from '@/src/lib/pairing';
import { registerUsageSync, unregisterUsageSync } from '@/src/lib/backgroundSync';
import { hasUsageAccess, getAllowedPackages, isAccessibilityEnabled, openAccessibilitySettings, openUsageAccessSettings, setBlocking, syncInstalledApps, syncUsageToSupabase, usageAvailable } from '@/src/lib/nativeUsage';
import { scheduleStatus, Sched } from '@/src/lib/schedule';
import { supabase } from '@/src/lib/supabase';
import styles from '@/src/styles/timeguard';
import { C } from '@/src/theme';

type Req = { id: string; minutes: number; status: 'pending' | 'approved' | 'denied'; created_at: string };

function PermRow({ label, hint, ok, onPress }: { label: string; hint: string; ok: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.permRow} onPress={onPress} disabled={ok}>
      <View style={{ flex: 1 }}>
        <Text style={styles.deviceName}>{label}</Text>
        <Text style={styles.muted}>{hint}</Text>
      </View>
      {ok ? (
        <View style={[styles.permBadge, styles.permBadgeOk]}><Ionicons name="checkmark" size={14} color={C.paper} /><Text style={styles.permBadgeOkText}>Activo</Text></View>
      ) : (
        <View style={styles.permBadge}><Text style={styles.permBadgeText}>Activar</Text></View>
      )}
    </Pressable>
  );
}

export default function MonitoredScreen({ device, onExit }: { device: MonitoredDevice; onExit: () => void }) {
  const [blocked, setBlocked] = useState(false);
  const [limit, setLimit] = useState(120);
  const [usage, setUsage] = useState(0);
  const [requests, setRequests] = useState<Req[]>([]);
  const [schedules, setSchedules] = useState<Sched[]>([]);
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [perms, setPerms] = useState({ usage: false, accessibility: false });
  const [allowedPkgs, setAllowedPkgs] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const refreshPerms = () => { if (usageAvailable) setPerms({ usage: hasUsageAccess(), accessibility: isAccessibilityEnabled() }); };

  const load = async () => {
    const d = await supabase.from('devices').select('blocked').eq('id', device.deviceId).maybeSingle();
    if (d.data) setBlocked(!!d.data.blocked);
    const l = await supabase.from('device_limits').select('daily_minutes').eq('device_id', device.deviceId).maybeSingle();
    if (l.data) setLimit(l.data.daily_minutes);
    const u = await supabase.from('device_sessions').select('duration_minutes').eq('device_id', device.deviceId);
    setUsage((u.data || []).reduce((s, r) => s + (r.duration_minutes || 0), 0));
    const r = await supabase.from('extra_time_requests').select('id,minutes,status,created_at').eq('device_id', device.deviceId).order('created_at', { ascending: false }).limit(5);
    setRequests(r.data || []);
    const sc = await supabase.from('schedules').select('label,starts_at,ends_at,enabled').eq('device_id', device.deviceId);
    setSchedules((sc.data || []) as Sched[]);
    const ma = await supabase.from('managed_apps').select('package_name,allowed').eq('device_id', device.deviceId);
    setAllowedPkgs((ma.data || []).filter((a) => a.allowed && a.package_name).map((a) => a.package_name as string));
    setBusy(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`monitored-${device.deviceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `id=eq.${device.deviceId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extra_time_requests', filter: `device_id=eq.${device.deviceId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_limits', filter: `device_id=eq.${device.deviceId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules', filter: `device_id=eq.${device.deviceId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'managed_apps', filter: `device_id=eq.${device.deviceId}` }, load)
      .subscribe();
    const timer = setInterval(() => setTick((t) => t + 1), 30000); // re-evaluate schedule window
    return () => { supabase.removeChannel(channel); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.deviceId]);

  // Refresh native permission state on mount and whenever the app returns to foreground.
  useEffect(() => {
    refreshPerms();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refreshPerms(); });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enforcement: keep the native blocker in sync with block flag + schedule window + allowlist.
  useEffect(() => {
    if (!usageAvailable) return;
    const apply = () => { const s = scheduleStatus(schedules); setBlocking(blocked || (s.restricted && !s.allowed), allowedPkgs); };
    apply();
    const id = setInterval(apply, 30000);
    return () => clearInterval(id);
  }, [blocked, schedules, allowedPkgs]);

  // Heartbeat: mark this device online so the parent sees live presence.
  useEffect(() => {
    const beat = () => supabase.from('devices').update({ online: true, last_seen_at: new Date().toISOString() }).eq('id', device.deviceId);
    beat();
    const id = setInterval(beat, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.deviceId]);

  const doSync = async () => {
    setSyncing(true); setSyncMsg('');
    const res = await syncUsageToSupabase(device.deviceId);
    setSyncing(false);
    if (res) { setSyncMsg(`Sincronizado: ${res.total} min en ${res.apps} apps.`); load(); }
  };

  // Auto-sync: periodic while the app is open + register OS background task (best-effort).
  useEffect(() => {
    if (!usageAvailable || !perms.usage) return;
    registerUsageSync();
    syncInstalledApps(device.deviceId).then(() => getAllowedPackages(device.deviceId)).then(setAllowedPkgs);
    syncUsageToSupabase(device.deviceId).then(() => load());
    const id = setInterval(() => { syncUsageToSupabase(device.deviceId).then(() => load()); }, 180000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms.usage, device.deviceId]);

  const askMore = async () => {
    setSending(true);
    await supabase.from('extra_time_requests').insert({ device_id: device.deviceId, minutes: 30, reason: 'Solicitud desde el dispositivo monitorizado' });
    setSending(false);
    load();
  };

  const exit = async () => { await unregisterUsageSync(); await supabase.from('devices').update({ online: false }).eq('id', device.deviceId); await clearRole(); await supabase.auth.signOut(); onExit(); };

  if (busy) return <View style={styles.loading}><ActivityIndicator color={C.forest} size="large" /><Text style={styles.loadingText}>Conectando con tu familia…</Text></View>;

  const pending = requests.find((r) => r.status === 'pending');
  const latest = requests[0];
  const percent = Math.min(100, Math.round((usage / Math.max(1, limit)) * 100));
  const sched = scheduleStatus(schedules);
  const scheduleLocked = sched.restricted && !sched.allowed;
  const effectiveBlocked = blocked || scheduleLocked;
  const lockTitle = blocked ? 'Tiempo en pausa' : 'Fuera del horario';
  const lockCopy = blocked
    ? 'Tu familia ha puesto tu dispositivo en pausa. Puedes pedir más tiempo y ellos decidirán.'
    : `El uso está permitido solo en tus horarios.${sched.nextStart ? ` Próxima franja${sched.nextLabel ? ` “${sched.nextLabel}”` : ''} a las ${sched.nextStart}.` : ''}`;

  if (effectiveBlocked) {
    return (
      <SafeAreaView style={styles.lockSafe}>
        <View style={styles.lockWrap} testID="monitored-locked">
          <View style={styles.lockIcon}><Ionicons name={blocked ? 'lock-closed' : 'time-outline'} size={44} color={C.paper} /></View>
          <Text style={styles.lockTitle}>{lockTitle}</Text>
          <Text style={styles.lockCopy}>{lockCopy}</Text>
          {pending ? (
            <View style={styles.lockPending}><Ionicons name="hourglass-outline" size={18} color={C.ochre} /><Text style={styles.lockPendingText}>Solicitud enviada. Esperando respuesta…</Text></View>
          ) : (
            <Pressable testID="request-more-locked" style={styles.lockButton} onPress={askMore} disabled={sending}>
              <Text style={styles.lockButtonText}>{sending ? 'Enviando…' : 'Pedir 30 minutos más'}</Text>
            </Pressable>
          )}
          {latest && latest.status !== 'pending' && (
            <Text style={[styles.lockStatus, { color: latest.status === 'approved' ? '#9BE3C0' : '#F2B8B2' }]}>
              Última solicitud: {latest.status === 'approved' ? 'aprobada' : 'denegada'}
            </Text>
          )}
          <Pressable testID="monitored-exit-locked" style={styles.lockExit} onPress={exit}><Text style={styles.lockExitText}>Desvincular</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.appSafe}>
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.headerOverline}>DISPOSITIVO MONITORIZADO</Text>
          <Text style={styles.headerTitle}>Hola, {device.profileName}</Text>
        </View>
        <View style={[styles.deviceIcon, { backgroundColor: C.sage }]}><Ionicons name="happy-outline" size={22} color={C.forest} /></View>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>PERFIL · {profileTypeLabel(device.profileType).toUpperCase()}</Text>
        <View style={styles.usagePanel}>
          <View style={styles.usageText}>
            <Text style={styles.label}>TIEMPO DE HOY</Text>
            <Text style={styles.bigMetric}>{Math.floor(usage / 60)}h {usage % 60}m</Text>
            <Text style={styles.muted}>de {Math.floor(limit / 60)}h {limit % 60}m permitidos</Text>
          </View>
          <View style={styles.ring}><Text style={styles.ringValue}>{percent}%</Text><Text style={styles.ringLabel}>usado</Text></View>
        </View>

        {sched.restricted && sched.allowed && (
          <View style={styles.alert} testID="schedule-within">
            <Ionicons name="checkmark-circle-outline" size={22} color={C.success} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Dentro de tu horario{sched.currentLabel ? `: ${sched.currentLabel}` : ''}</Text>
              <Text style={styles.alertText}>Puedes usar el dispositivo ahora mismo.</Text>
            </View>
          </View>
        )}

        {!usageAvailable ? (
          <View style={styles.alert} testID="native-unavailable">
            <Ionicons name="information-circle-outline" size={22} color={C.terracotta} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Medición y bloqueo real</Text>
              <Text style={styles.alertText}>Se activan al instalar el build de Android (no en Expo Go).</Text>
            </View>
          </View>
        ) : (
          <View style={styles.nativeCard} testID="native-panel">
            <Text style={styles.label}>MEDICIÓN Y BLOQUEO (ANDROID)</Text>
            <PermRow label="Acceso de uso" hint="Para medir el tiempo por app" ok={perms.usage} onPress={openUsageAccessSettings} />
            <PermRow label="Accesibilidad" hint="Para pausar apps al bloquear" ok={perms.accessibility} onPress={openAccessibilitySettings} />
            <Pressable testID="sync-usage" style={[styles.secondaryButton, { marginTop: 12 }]} onPress={doSync} disabled={syncing || !perms.usage}>
              <Ionicons name="sync-outline" size={18} color={C.forest} />
              <Text style={styles.secondaryText}>{syncing ? 'Sincronizando…' : 'Sincronizar uso ahora'}</Text>
            </Pressable>
            {!!syncMsg && <Text style={[styles.muted, { marginTop: 8 }]}>{syncMsg}</Text>}
            <Text style={[styles.muted, { marginTop: 6 }]}>Se sincroniza automáticamente cada pocos minutos y en segundo plano.</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>¿Necesitas más tiempo?</Text>
        {pending ? (
          <View style={styles.requestCard} testID="monitored-pending">
            <View style={styles.requestIcon}><Ionicons name="hourglass-outline" size={20} color={C.ochre} /></View>
            <View style={{ flex: 1 }}><Text style={styles.deviceName}>Solicitud enviada (+{pending.minutes} min)</Text><Text style={styles.muted}>Esperando la respuesta de tu familia…</Text></View>
          </View>
        ) : (
          <Pressable testID="request-more" style={styles.primaryButton} onPress={askMore} disabled={sending}>
            <Ionicons name="add-circle-outline" size={18} color={C.paper} />
            <Text style={styles.primaryText}>{sending ? 'Enviando…' : 'Pedir 30 minutos más'}</Text>
          </Pressable>
        )}

        {requests.length > 0 && <Text style={styles.sectionTitle}>Tus solicitudes</Text>}
        {requests.map((r) => (
          <View key={r.id} style={styles.requestCard} testID={`monitored-req-${r.id}`}>
            <View style={styles.requestIcon}><Ionicons name="time-outline" size={20} color={C.forest} /></View>
            <View style={{ flex: 1 }}><Text style={styles.deviceName}>+{r.minutes} min</Text><Text style={styles.muted}>{new Date(r.created_at).toLocaleString('es-ES')}</Text></View>
            <Text style={[styles.statusText, { color: r.status === 'approved' ? C.success : r.status === 'denied' ? C.danger : C.ochre }]}>
              {r.status === 'approved' ? 'APROBADA' : r.status === 'denied' ? 'DENEGADA' : 'PENDIENTE'}
            </Text>
          </View>
        ))}

        <Pressable testID="monitored-exit" style={styles.signOut} onPress={exit}><Text style={styles.signOutText}>Desvincular este dispositivo</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
