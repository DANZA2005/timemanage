import { Ionicons } from '@expo/vector-icons';
import { Session } from '@supabase/supabase-js';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { clearRole, createPairingCode, PROFILE_TYPES, profileTypeLabel } from '@/src/lib/pairing';
import { supabase } from '@/src/lib/supabase';
import styles from '@/src/styles/timeguard';
import { C } from '@/src/theme';

type Device = { id: string; name: string; profile_name: string; profile_type: string; online: boolean; blocked: boolean; platform: string; pairing_code?: string; last_seen_at?: string | null };
type TimeRequest = { id: string; device_id: string; minutes: number; reason: string | null; status: 'pending' | 'approved' | 'denied' };
type Schedule = { id: string; device_id: string; label: string; starts_at: string; ends_at: string; enabled: boolean };
type AppTotal = { app_name: string; minutes: number };
type ManagedApp = { id: string; device_id: string; app_name: string; package_name: string | null; allowed: boolean };

const TABS = ['Resumen', 'Actividad', 'Controles', 'Ajustes'];
const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const APP_COLORS = [C.terracotta, C.ochre, C.sky, C.forest, C.success, C.muted];

function isOnline(d: Device): boolean {
  if (d.last_seen_at) return Date.now() - new Date(d.last_seen_at).getTime() < 5 * 60000;
  return d.online;
}

export default function ParentDashboard({ session, onExit }: { session: Session; onExit: () => void }) {
  const [tab, setTab] = useState('Resumen');
  const [devices, setDevices] = useState<Device[]>([]);
  const [requests, setRequests] = useState<TimeRequest[]>([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [schedules, setSchedules] = useState<Record<string, Schedule[]>>({});
  const [appTotals, setAppTotals] = useState<AppTotal[]>([]);
  const [weekly, setWeekly] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [managedApps, setManagedApps] = useState<Record<string, ManagedApp[]>>({});
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [usage, setUsage] = useState(0);
  const [busy, setBusy] = useState(true);
  const [pairing, setPairing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = async (silent = false) => {
    if (!silent) setBusy(true);
    setLoadError('');
    const user = session.user;
    let { data: member, error: memberError } = await supabase.from('family_members').select('family_id').eq('user_id', user.id).eq('member_role', 'parent').limit(1).maybeSingle();
    if (memberError) { setLoadError(`No pudimos cargar tu familia.\n\nDetalle: ${memberError.message}`); setBusy(false); return; }
    if (!member) {
      const created = await supabase.from('families').insert({ name: 'Mi familia', owner_id: user.id }).select('id').single();
      if (created.data) { await supabase.from('family_members').insert({ family_id: created.data.id, user_id: user.id, member_role: 'parent' }); member = { family_id: created.data.id }; }
    }
    if (!member) { setBusy(false); return; }
    setFamilyId(member.family_id);
    const d = await supabase.from('devices').select('id,name,profile_name,profile_type,online,blocked,platform,pairing_code,last_seen_at').eq('family_id', member.family_id).order('created_at');
    if (d.error) { setLoadError(`No pudimos cargar los dispositivos.\n\nDetalle: ${d.error.message}`); setBusy(false); return; }
    const list = (d.data || []) as Device[];
    setDevices(list);
    setSelectedId((prev) => (prev && list.some((x) => x.id === prev) ? prev : list[0]?.id ?? null));
    const deviceIds = list.map((x) => x.id);
    if (deviceIds.length) {
      const u = await supabase.from('device_sessions').select('duration_minutes').in('device_id', deviceIds);
      setUsage((u.data || []).reduce((sum, row) => sum + (row.duration_minutes || 0), 0));
      const r = await supabase.from('extra_time_requests').select('id,device_id,minutes,reason,status').in('device_id', deviceIds).order('created_at', { ascending: false });
      setRequests((r.data || []) as TimeRequest[]);
      const lim = await supabase.from('device_limits').select('device_id,daily_minutes').in('device_id', deviceIds);
      const limMap: Record<string, number> = {};
      (lim.data || []).forEach((x) => { limMap[x.device_id] = x.daily_minutes; });
      setLimits(limMap);
      const sch = await supabase.from('schedules').select('id,device_id,label,starts_at,ends_at,enabled').in('device_id', deviceIds).order('starts_at');
      const schMap: Record<string, Schedule[]> = {};
      (sch.data || []).forEach((x) => { (schMap[x.device_id] ||= []).push(x as Schedule); });
      setSchedules(schMap);
      const todayMidMs = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime(); })();
      const today = new Date().toISOString().slice(0, 10);
      const au = await supabase.from('app_usage').select('app_name,minutes').in('device_id', deviceIds).eq('usage_date', today);
      const totalsMap: Record<string, number> = {};
      (au.data || []).forEach((x) => { totalsMap[x.app_name] = (totalsMap[x.app_name] || 0) + (x.minutes || 0); });
      setAppTotals(Object.entries(totalsMap).map(([app_name, minutes]) => ({ app_name, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 6));
      const since = new Date(todayMidMs - 6 * 86400000);
      const ws = await supabase.from('device_sessions').select('duration_minutes,started_at').in('device_id', deviceIds).gte('started_at', since.toISOString());
      const days = [0, 0, 0, 0, 0, 0, 0];
      (ws.data || []).forEach((x) => { const dt = new Date(x.started_at); dt.setHours(0, 0, 0, 0); const idx = 6 - Math.round((todayMidMs - dt.getTime()) / 86400000); if (idx >= 0 && idx < 7) days[idx] += (x.duration_minutes || 0); });
      setWeekly(days);
      const ma = await supabase.from('managed_apps').select('id,device_id,app_name,package_name,allowed').in('device_id', deviceIds).order('app_name');
      const maMap: Record<string, ManagedApp[]> = {};
      (ma.data || []).forEach((x) => { (maMap[x.device_id] ||= []).push(x as ManagedApp); });
      setManagedApps(maMap);
    } else {
      setUsage(0); setRequests([]); setLimits({}); setSchedules({}); setAppTotals([]); setWeekly([0, 0, 0, 0, 0, 0, 0]); setManagedApps({});
    }
    setBusy(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [session.user.id]);
  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`family-${familyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: `family_id=eq.${familyId}` }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extra_time_requests' }, () => load(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_usage' }, () => load(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  const toggleBlock = async (device: Device) => { await supabase.from('devices').update({ blocked: !device.blocked }).eq('id', device.id); load(true); };
  const decideRequest = async (request: TimeRequest, status: 'approved' | 'denied') => { await supabase.from('extra_time_requests').update({ status }).eq('id', request.id); load(true); };
  const setProfileType = async (deviceId: string, type: string) => { await supabase.from('devices').update({ profile_type: type }).eq('id', deviceId); load(true); };
  const saveLimit = async (deviceId: string, minutes: number) => { setLimits((p) => ({ ...p, [deviceId]: minutes })); await supabase.from('device_limits').upsert({ device_id: deviceId, daily_minutes: minutes }, { onConflict: 'device_id' }); };
  const addSchedule = async (deviceId: string, label: string, start: string, end: string) => { await supabase.from('schedules').insert({ device_id: deviceId, label, starts_at: `${start}:00`, ends_at: `${end}:00` }); load(true); };
  const toggleSchedule = async (s: Schedule) => { await supabase.from('schedules').update({ enabled: !s.enabled }).eq('id', s.id); load(true); };
  const deleteSchedule = async (s: Schedule) => { await supabase.from('schedules').delete().eq('id', s.id); load(true); };
  const toggleManagedApp = async (m: ManagedApp) => { await supabase.from('managed_apps').update({ allowed: !m.allowed }).eq('id', m.id); load(true); };

  const exit = async () => { await clearRole(); await supabase.auth.signOut(); onExit(); };

  const selected = useMemo(() => devices.find((x) => x.id === selectedId) || devices[0] || null, [devices, selectedId]);
  const limit = selected ? (limits[selected.id] ?? 120) : 120;

  if (busy) return <View style={styles.loading}><ActivityIndicator color={C.forest} size="large" /><Text style={styles.loadingText}>Cargando tu familia…</Text></View>;
  if (loadError) return (
    <SafeAreaView style={styles.appSafe}>
      <View style={styles.errorPanel}>
        <Ionicons name="warning-outline" size={30} color={C.terracotta} />
        <Text style={styles.sectionTitle}>Falta preparar Supabase</Text>
        <Text style={styles.pageCopy}>{loadError}</Text>
        <Pressable style={styles.primaryButton} onPress={() => load()}><Text style={styles.primaryText}>Reintentar</Text></Pressable>
        <Pressable style={styles.signOut} onPress={exit}><Text style={styles.signOutText}>Cerrar sesión</Text></Pressable>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.appSafe}>
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.headerOverline}>FAMILIA · PADRE/MADRE</Text>
          <Text style={styles.headerTitle}>Hola, {session.user.user_metadata?.display_name || 'familia'}</Text>
        </View>
        <Pressable testID="header-settings" style={styles.iconButton} onPress={() => setTab('Ajustes')}><Ionicons name="settings-outline" size={22} color={C.ink} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {tab === 'Resumen' && <Summary devices={devices} usage={usage} limit={limit} weekly={weekly} onPair={() => setPairing(true)} onControls={() => setTab('Controles')} onBlock={toggleBlock} />}
        {tab === 'Actividad' && <Activity usage={usage} devices={devices} requests={requests} appTotals={appTotals} weekly={weekly} onDecide={decideRequest} />}
        {tab === 'Controles' && (
          <Controls
            devices={devices}
            selected={selected}
            onSelect={setSelectedId}
            limit={limit}
            onSaveLimit={saveLimit}
            onSetType={setProfileType}
            onBlock={toggleBlock}
            onPair={() => setPairing(true)}
            schedules={selected ? schedules[selected.id] || [] : []}
            onAddSchedule={addSchedule}
            onToggleSchedule={toggleSchedule}
            onDeleteSchedule={deleteSchedule}
            managedApps={selected ? managedApps[selected.id] || [] : []}
            onToggleApp={toggleManagedApp}
          />
        )}
        {tab === 'Ajustes' && <Settings email={session.user.email || ''} onSignOut={exit} />}
      </ScrollView>
      {pairing && familyId && <Pairing familyId={familyId} onClose={() => setPairing(false)} />}
      <View style={styles.tabs}>
        {TABS.map((item) => (
          <Pressable testID={`tab-${item.toLowerCase()}`} key={item} onPress={() => setTab(item)} style={styles.tab}>
            <Ionicons name={item === 'Resumen' ? 'grid-outline' : item === 'Actividad' ? 'bar-chart-outline' : item === 'Controles' ? 'options-outline' : 'settings-outline'} size={20} color={tab === item ? C.forest : C.muted} />
            <Text style={[styles.tabText, tab === item && styles.tabActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function WeekChart({ weekly }: { weekly: number[] }) {
  const max = Math.max(1, ...weekly);
  const today = new Date();
  return (
    <View style={styles.chart}>
      {weekly.map((m, i) => {
        const date = new Date(); date.setDate(today.getDate() - (6 - i));
        const h = Math.round((m / max) * 100);
        return (
          <View key={i} style={styles.barCol}>
            <View style={[styles.bar, { height: `${Math.max(4, h)}%` as any, backgroundColor: i === 6 ? C.terracotta : C.forest }]} />
            <Text style={styles.barDay}>{DAY_LETTERS[date.getDay()]}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Summary({ devices, usage, limit, weekly, onPair, onControls, onBlock }: { devices: Device[]; usage: number; limit: number; weekly: number[]; onPair: () => void; onControls: () => void; onBlock: (d: Device) => void }) {
  const percent = Math.min(100, Math.round((usage / Math.max(1, limit)) * 100));
  const pendingBlocked = devices.filter((d) => d.blocked).length;
  return (
    <>
      <Text style={styles.eyebrow}>RESUMEN DE HOY · {new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
      <View style={styles.alert}>
        <Ionicons name="sunny-outline" size={22} color={C.terracotta} />
        <View style={{ flex: 1 }}>
          <Text style={styles.alertTitle}>{devices.length ? (pendingBlocked ? `${pendingBlocked} dispositivo(s) en pausa` : 'Todo bajo control') : 'Empieza vinculando un dispositivo'}</Text>
          <Text style={styles.alertText}>{devices.length ? 'Revisa el resumen y las solicitudes de tu familia.' : 'Conecta el móvil de tu hijo/a para ver su actividad.'}</Text>
        </View>
      </View>
      <View style={styles.usagePanel}>
        <View style={styles.usageText}>
          <Text style={styles.label}>TIEMPO DE PANTALLA</Text>
          <Text style={styles.bigMetric}>{Math.floor(usage / 60)}h {usage % 60}m</Text>
          <Text style={styles.muted}>de {Math.floor(limit / 60)}h {limit % 60}m diarios</Text>
        </View>
        <View style={styles.ring}><Text style={styles.ringValue}>{percent}%</Text><Text style={styles.ringLabel}>usado</Text></View>
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Dispositivos</Text>
        <Pressable testID="summary-pair" onPress={onPair}><Text style={styles.actionText}>+ Vincular</Text></Pressable>
      </View>
      {devices.length ? devices.map((d) => <DeviceRow key={d.id} device={d} onBlock={() => onBlock(d)} />) : (
        <Pressable testID="empty-pair" style={styles.emptyDevice} onPress={onPair}>
          <Ionicons name="add-circle-outline" size={26} color={C.forest} />
          <Text style={styles.emptyTitle}>Vincular primer dispositivo</Text>
          <Text style={styles.muted}>Genera un código o QR para comenzar.</Text>
        </Pressable>
      )}
      <View style={styles.twoActions}>
        <Pressable style={styles.secondaryButton} onPress={onControls}><Ionicons name="options-outline" size={18} color={C.forest} /><Text style={styles.secondaryText}>Editar límites</Text></Pressable>
        <Pressable style={styles.secondaryButton} onPress={onPair}><Ionicons name="qr-code-outline" size={18} color={C.forest} /><Text style={styles.secondaryText}>Código / QR</Text></Pressable>
      </View>
      <Text style={styles.sectionTitle}>Últimos 7 días</Text>
      <WeekChart weekly={weekly} />
    </>
  );
}

function DeviceRow({ device, onBlock }: { device: Device; onBlock: () => void }) {
  const online = isOnline(device);
  return (
    <View style={styles.deviceRow}>
      <View style={[styles.deviceIcon, { backgroundColor: device.blocked ? '#F5D8D3' : C.sage }]}>
        <Ionicons name={device.platform === 'android' ? 'phone-portrait-outline' : 'tv-outline'} size={22} color={device.blocked ? C.danger : C.forest} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.deviceName}>{device.profile_name}</Text>
        <View style={styles.deviceMetaRow}>
          <View style={[styles.onlineDot, { backgroundColor: online ? C.success : C.border }]} />
          <Text style={styles.muted}>{profileTypeLabel(device.profile_type)} · {online ? 'En línea' : 'Sin conexión'}</Text>
        </View>
      </View>
      <Pressable testID={`block-${device.id}`} onPress={onBlock} style={styles.blockControl}>
        <Text style={[styles.statusText, { color: device.blocked ? C.danger : C.success }]}>{device.blocked ? 'Bloqueado' : 'Activo'}</Text>
        <Switch value={device.blocked} onValueChange={onBlock} trackColor={{ false: C.border, true: '#E8B1A4' }} thumbColor={device.blocked ? C.danger : C.surface} />
      </Pressable>
    </View>
  );
}

function Activity({ usage, devices, requests, onDecide }: { usage: number; devices: Device[]; requests: TimeRequest[]; onDecide: (r: TimeRequest, s: 'approved' | 'denied') => void }) {
  const pending = requests.filter((r) => r.status === 'pending');
  const deviceName = (id: string) => devices.find((d) => d.id === id)?.profile_name || 'Dispositivo';
  return (
    <>
      <Text style={styles.eyebrow}>ACTIVIDAD</Text>
      <Text style={styles.pageTitle}>Una semana de hábitos.</Text>
      <Text style={styles.pageCopy}>Revisa el ritmo de uso y responde a las solicitudes de tiempo.</Text>
      <View style={styles.statGrid}>
        <Stat label="HOY" value={`${Math.floor(usage / 60)}h ${usage % 60}m`} />
        <Stat label="PROMEDIO" value="2h 18m" />
        <Stat label="EQUIPOS" value={`${devices.length}`} />
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Solicitudes de tiempo extra</Text>
        {pending.length > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{pending.length}</Text></View>}
      </View>
      {requests.length ? requests.map((r) => (
        <View testID={`request-${r.id}`} key={r.id} style={styles.requestCard}>
          <View style={styles.requestIcon}><Ionicons name="time-outline" size={20} color={C.forest} /></View>
          <View style={{ flex: 1 }}><Text style={styles.deviceName}>{deviceName(r.device_id)} · +{r.minutes} min</Text><Text style={styles.muted}>{r.reason || 'Sin motivo indicado'}</Text></View>
          {r.status === 'pending' ? (
            <View style={styles.requestActions}>
              <Pressable testID={`deny-${r.id}`} onPress={() => onDecide(r, 'denied')} style={styles.denyBtn}><Ionicons name="close" size={19} color={C.danger} /></Pressable>
              <Pressable testID={`approve-${r.id}`} onPress={() => onDecide(r, 'approved')} style={styles.approveBtn}><Ionicons name="checkmark" size={19} color={C.paper} /></Pressable>
            </View>
          ) : (
            <Text style={[styles.statusText, { color: r.status === 'approved' ? C.success : C.danger }]}>{r.status === 'approved' ? 'APROBADA' : 'DENEGADA'}</Text>
          )}
        </View>
      )) : <Text style={styles.muted}>No hay solicitudes por ahora.</Text>}
      <Text style={styles.sectionTitle}>Aplicaciones más usadas</Text>
      {['YouTube', 'Juegos', 'Chrome', 'Mensajes'].map((app, i) => (
        <View style={styles.appRow} key={app}><View style={[styles.appDot, { backgroundColor: [C.terracotta, C.ochre, C.sky, C.forest][i] }]} /><Text style={styles.appName}>{app}</Text><Text style={styles.appMinutes}>{[48, 32, 21, 14][i]} min</Text></View>
      ))}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <View style={styles.stat}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.label}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>;
}

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function Controls({ devices, selected, onSelect, limit, onSaveLimit, onSetType, onBlock, onPair, schedules, onAddSchedule, onToggleSchedule, onDeleteSchedule }: {
  devices: Device[]; selected: Device | null; onSelect: (id: string) => void; limit: number;
  onSaveLimit: (id: string, m: number) => void; onSetType: (id: string, t: string) => void; onBlock: (d: Device) => void; onPair: () => void;
  schedules: Schedule[]; onAddSchedule: (id: string, label: string, start: string, end: string) => void; onToggleSchedule: (s: Schedule) => void; onDeleteSchedule: (s: Schedule) => void;
}) {
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [schedError, setSchedError] = useState('');

  if (!selected) {
    return (
      <>
        <Text style={styles.eyebrow}>CONTROLES</Text>
        <Text style={styles.pageTitle}>Límites que acompañan.</Text>
        <Text style={styles.pageCopy}>Aún no hay dispositivos. Vincula uno para configurar perfiles, límites y horarios.</Text>
        <Pressable testID="controls-pair" style={styles.primaryButton} onPress={onPair}><Ionicons name="qr-code-outline" size={18} color={C.paper} /><Text style={styles.primaryText}>Vincular dispositivo</Text></Pressable>
      </>
    );
  }

  const submitSchedule = () => {
    if (!label.trim()) { setSchedError('Escribe una etiqueta (p. ej. "Tarde escolar").'); return; }
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) { setSchedError('Usa el formato HH:MM (24h), p. ej. 15:00.'); return; }
    setSchedError('');
    onAddSchedule(selected.id, label.trim(), start, end);
    setLabel(''); setStart(''); setEnd('');
  };

  return (
    <>
      <Text style={styles.eyebrow}>CONTROLES</Text>
      <Text style={styles.pageTitle}>Límites que acompañan.</Text>
      <Text style={styles.pageCopy}>Elige un dispositivo y ajusta su perfil, límite diario y horarios.</Text>

      {devices.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chipRowContent}>
          {devices.map((d) => (
            <Pressable key={d.id} testID={`device-chip-${d.id}`} onPress={() => onSelect(d.id)} style={[styles.chip, selected.id === d.id && styles.chipActive]}>
              <Text style={[styles.chipText, selected.id === d.id && styles.chipTextActive]}>{d.profile_name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={styles.controlSelect}>
        <Text style={styles.label}>PERFIL MONITORIZADO</Text>
        <Text style={styles.deviceName}>{selected.profile_name}</Text>
        <Text style={styles.muted}>{selected.name}</Text>
      </View>

      <Text style={styles.sectionTitle}>Tipo de perfil</Text>
      <View style={styles.typeRow}>
        {PROFILE_TYPES.map((t) => (
          <Pressable key={t.key} testID={`type-${t.key}`} onPress={() => onSetType(selected.id, t.key)} style={[styles.typeChip, selected.profile_type === t.key && styles.typeChipActive]}>
            <Ionicons name={t.icon as any} size={18} color={selected.profile_type === t.key ? C.paper : C.forest} />
            <Text style={[styles.typeChipText, selected.profile_type === t.key && { color: C.paper }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.limitCard}>
        <Text style={styles.label}>LÍMITE DIARIO</Text>
        <Text style={styles.limitValue}>{Math.floor(limit / 60)}h {limit % 60}m</Text>
        <View style={styles.limitChoices}>
          {[60, 120, 180, 240].map((v) => (
            <Pressable key={v} testID={`limit-${v}`} onPress={() => onSaveLimit(selected.id, v)} style={[styles.choice, limit === v && styles.choiceActive]}>
              <Text style={[styles.choiceText, limit === v && { color: C.paper }]}>{v / 60}h</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.muted}>El límite se guarda al instante en Supabase.</Text>
      </View>

      <View style={styles.controlRow}>
        <View><Text style={styles.deviceName}>Bloqueo del dispositivo</Text><Text style={styles.muted}>Estado actual: {selected.blocked ? 'bloqueado' : 'activo'}</Text></View>
        <Switch testID="control-block" value={!!selected.blocked} onValueChange={() => onBlock(selected)} trackColor={{ false: C.border, true: '#E8B1A4' }} thumbColor={selected.blocked ? C.danger : C.surface} />
      </View>

      <Text style={styles.sectionTitle}>Horarios permitidos</Text>
      {schedules.length ? schedules.map((s) => (
        <View key={s.id} testID={`schedule-${s.id}`} style={styles.scheduleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.deviceName}>{s.label}</Text>
            <Text style={styles.muted}>{s.starts_at.slice(0, 5)} – {s.ends_at.slice(0, 5)}</Text>
          </View>
          <Switch testID={`schedule-toggle-${s.id}`} value={s.enabled} onValueChange={() => onToggleSchedule(s)} trackColor={{ false: C.border, true: C.sage }} thumbColor={s.enabled ? C.forest : C.surface} />
          <Pressable testID={`schedule-delete-${s.id}`} onPress={() => onDeleteSchedule(s)} style={styles.deleteBtn}><Ionicons name="trash-outline" size={18} color={C.danger} /></Pressable>
        </View>
      )) : <Text style={styles.muted}>Sin horarios. Añade franjas en las que se permite el uso.</Text>}

      <View style={styles.scheduleAdd}>
        <TextInput testID="schedule-label" style={styles.input} placeholder="Etiqueta (p. ej. Tarde escolar)" placeholderTextColor={C.muted} value={label} onChangeText={setLabel} />
        <View style={styles.timeRow}>
          <TextInput testID="schedule-start" style={[styles.input, styles.timeInput]} placeholder="Inicio 15:00" placeholderTextColor={C.muted} value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" maxLength={5} />
          <TextInput testID="schedule-end" style={[styles.input, styles.timeInput]} placeholder="Fin 18:00" placeholderTextColor={C.muted} value={end} onChangeText={setEnd} keyboardType="numbers-and-punctuation" maxLength={5} />
        </View>
        {!!schedError && <Text style={styles.formMessage}>{schedError}</Text>}
        <Pressable testID="schedule-add" style={styles.primaryButton} onPress={submitSchedule}><Ionicons name="add" size={18} color={C.paper} /><Text style={styles.primaryText}>Añadir horario</Text></Pressable>
      </View>

      <Pressable style={styles.linkButton} onPress={onPair}><Text style={styles.linkText}>+ Vincular otro dispositivo</Text></Pressable>
    </>
  );
}

function Settings({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <>
      <Text style={styles.eyebrow}>AJUSTES</Text>
      <Text style={styles.pageTitle}>Tu espacio familiar.</Text>
      <View style={styles.profileCard}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{email.slice(0, 1).toUpperCase()}</Text></View>
        <View><Text style={styles.deviceName}>Administrador</Text><Text style={styles.muted}>{email}</Text></View>
      </View>
      {['Notificaciones', 'Horarios de descanso', 'Privacidad y datos', 'Ayuda'].map((item, i) => (
        <Pressable style={styles.settingsRow} key={item}>
          <Ionicons name={['notifications-outline', 'moon-outline', 'shield-checkmark-outline', 'help-circle-outline'][i] as any} size={21} color={C.forest} />
          <Text style={[styles.deviceName, { flex: 1 }]}>{item}</Text>
          <Ionicons name="chevron-forward" size={18} color={C.muted} />
        </Pressable>
      ))}
      <Pressable testID="parent-signout" style={styles.signOut} onPress={onSignOut}><Text style={styles.signOutText}>Cerrar sesión</Text></Pressable>
    </>
  );
}

function Pairing({ familyId, onClose }: { familyId: string; onClose: () => void }) {
  const [profileName, setProfileName] = useState('Perfil infantil');
  const [profileType, setProfileType] = useState('nino');
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemaining(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const generate = async () => {
    setBusy(true); setError('');
    const result = await createPairingCode(familyId, { deviceName: 'Dispositivo monitorizado', profileName: profileName.trim() || 'Perfil infantil', profileType });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    setCode(result.data!.code);
    setExpiresAt(new Date(result.data!.expires_at).getTime());
  };

  const expired = expiresAt !== null && remaining <= 0;
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <View style={styles.modalBackdrop}>
      <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.modal}>
          <Pressable testID="pairing-close" style={styles.close} onPress={onClose}><Ionicons name="close" size={24} color={C.ink} /></Pressable>
          <Text style={styles.eyebrow}>VINCULAR DISPOSITIVO</Text>
          <Text style={styles.modalTitle}>Genera un código de un solo uso.</Text>
          <Text style={styles.pageCopy}>Se caduca en 10 minutos y solo puede usarse una vez. Introdúcelo en la app del dispositivo monitorizado.</Text>

          {!code ? (
            <>
              <TextInput testID="pairing-name" style={styles.input} placeholder="Nombre del perfil (p. ej. Sofía)" placeholderTextColor={C.muted} value={profileName} onChangeText={setProfileName} />
              <View style={styles.typeRow}>
                {PROFILE_TYPES.map((t) => (
                  <Pressable key={t.key} testID={`pair-type-${t.key}`} onPress={() => setProfileType(t.key)} style={[styles.typeChip, profileType === t.key && styles.typeChipActive]}>
                    <Text style={[styles.typeChipText, profileType === t.key && { color: C.paper }]}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>
              {!!error && <Text style={styles.formMessage}>{error}</Text>}
              <Pressable testID="pairing-generate" style={styles.primaryButton} onPress={generate} disabled={busy}>
                <Text style={styles.primaryText}>{busy ? 'Generando…' : 'Generar código'}</Text>
                {busy && <ActivityIndicator color={C.paper} />}
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.codeBox}><Text testID="pairing-code" style={styles.code}>{code}</Text><Text style={styles.muted}>CÓDIGO DE EMPAREJAMIENTO</Text></View>
              <View style={styles.qrWrap}>
                <QRCode value={code} size={150} color={C.ink} backgroundColor="#FFFFFF" />
              </View>
              {expired ? (
                <Text testID="pairing-expired" style={[styles.formMessage, { textAlign: 'center' }]}>El código caducó. Genera uno nuevo.</Text>
              ) : (
                <Text testID="pairing-countdown" style={styles.countdown}>Caduca en {mm}:{ss}</Text>
              )}
              <Pressable testID="pairing-regenerate" style={styles.primaryButton} onPress={generate} disabled={busy}>
                <Text style={styles.primaryText}>{busy ? 'Generando…' : 'Generar nuevo código'}</Text>
              </Pressable>
            </>
          )}
          <Pressable testID="pairing-done" style={styles.linkButton} onPress={onClose}><Text style={styles.linkText}>Listo</Text></Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
