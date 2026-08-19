import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';

import { supabase } from '@/src/lib/supabase';
import { setParentRole } from '@/src/lib/pairing';
import styles from '@/src/styles/timeguard';
import { C } from '@/src/theme';

export default function AuthScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async () => {
    if (!email || password.length < 6 || (mode === 'signup' && !name)) {
      setMessage('Completa los campos. La contraseña necesita 6 caracteres.');
      return;
    }
    setBusy(true);
    setMessage('');
    await setParentRole();
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else setMessage(mode === 'login' ? 'Bienvenido de nuevo.' : 'Cuenta creada. Revisa tu correo si la confirmación está activa.');
  };

  return (
    <SafeAreaView style={styles.authSafe}>
      <ScrollView contentContainerStyle={styles.authWrap} keyboardShouldPersistTaps="handled">
        <Pressable testID="auth-back" onPress={onBack} style={styles.backRow}>
          <Ionicons name="chevron-back" size={20} color={C.forest} />
          <Text style={styles.linkText}>Volver</Text>
        </Pressable>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Ionicons name="shield-checkmark" color={C.paper} size={22} /></View>
          <Text style={styles.brand}>TimeGuard</Text>
        </View>
        <Text style={styles.eyebrow}>PANEL DEL PADRE/MADRE</Text>
        <Text style={styles.heroTitle}>Más calma para cada momento de pantalla.</Text>
        <Text style={styles.heroCopy}>Un lugar claro para acompañar hábitos digitales, poner límites y estar al tanto sin invadir.</Text>
        <View style={styles.authCard}>
          <Text style={styles.cardTitle}>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta de padre'}</Text>
          {mode === 'signup' && <TextInput testID="auth-name" style={styles.input} placeholder="Tu nombre" placeholderTextColor={C.muted} value={name} onChangeText={setName} />}
          <TextInput testID="auth-email" style={styles.input} placeholder="Correo electrónico" placeholderTextColor={C.muted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextInput testID="auth-password" style={styles.input} placeholder="Contraseña" placeholderTextColor={C.muted} secureTextEntry value={password} onChangeText={setPassword} />
          {!!message && <Text style={styles.formMessage}>{message}</Text>}
          <Pressable testID="auth-submit" accessibilityRole="button" style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={submit} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? 'Conectando…' : mode === 'login' ? 'Entrar a mi familia' : 'Crear mi espacio'}</Text>
            {busy && <ActivityIndicator color={C.paper} />}
          </Pressable>
          <Pressable testID="auth-toggle" onPress={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }} style={styles.linkButton}>
            <Text style={styles.linkText}>{mode === 'login' ? '¿Primera vez? Crea una cuenta' : 'Ya tengo una cuenta'}</Text>
          </Pressable>
        </View>
        <Text style={styles.privacy}><Ionicons name="lock-closed" size={13} color={C.muted} /> Tus datos familiares están protegidos con Supabase.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
