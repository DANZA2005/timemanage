import { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { getMonitoredDevice, MonitoredDevice } from '@/src/lib/pairing';
import { supabase } from '@/src/lib/supabase';
import AuthScreen from '@/src/screens/AuthScreen';
import JoinScreen from '@/src/screens/JoinScreen';
import Landing from '@/src/screens/Landing';
import MonitoredScreen from '@/src/screens/MonitoredScreen';
import ParentDashboard from '@/src/screens/ParentDashboard';
import styles from '@/src/styles/timeguard';
import { C } from '@/src/theme';

type Choice = 'landing' | 'parent' | 'join';

export default function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [choice, setChoice] = useState<Choice>('landing');
  const [device, setDevice] = useState<MonitoredDevice | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user?.is_anonymous) setDevice(await getMonitoredDevice());
      setChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next);
      if (next?.user?.is_anonymous) setDevice(await getMonitoredDevice());
      else setDevice(null);
      setChecking(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={C.forest} size="large" />
        <Text style={styles.loadingText}>Preparando tu espacio familiar…</Text>
      </View>
    );
  }

  // Monitored (anonymous) device session
  if (session?.user?.is_anonymous) {
    if (device) return <MonitoredScreen device={device} onExit={() => { setSession(null); setDevice(null); setChoice('landing'); }} />;
    return <JoinScreen onBack={() => setChoice('landing')} onJoined={async () => setDevice(await getMonitoredDevice())} />;
  }

  // Parent (email) session
  if (session) return <ParentDashboard session={session} onExit={() => { setSession(null); setChoice('landing'); }} />;

  // No session yet — landing / auth / join
  if (choice === 'parent') return <AuthScreen onBack={() => setChoice('landing')} />;
  if (choice === 'join') return <JoinScreen onBack={() => setChoice('landing')} onJoined={async () => setDevice(await getMonitoredDevice())} />;
  return <Landing onParent={() => setChoice('parent')} onMonitored={() => setChoice('join')} />;
}
