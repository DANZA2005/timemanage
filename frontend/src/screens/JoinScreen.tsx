import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';

import { redeemCode } from '@/src/lib/pairing';
import styles from '@/src/styles/timeguard';
import { C } from '@/src/theme';

export default function JoinScreen({ onBack, onJoined }: { onBack: () => void; onJoined: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const join = async (raw: string) => {
    const value = raw.trim().toUpperCase();
    if (value.length < 4) { setMessage('Escribe el código completo.'); return; }
    setBusy(true);
    setMessage('');
    const result = await redeemCode(value);
    setBusy(false);
    if (result.error) setMessage(result.error);
    else onJoined();
  };

  const openScanner = async () => {
    setMessage('');
    if (permission?.granted) { setScanning(true); return; }
    if (permission && !permission.canAskAgain) {
      setMessage('Permiso de cámara bloqueado. Ábrelo desde Ajustes para escanear el QR.');
      return;
    }
    const res = await requestPermission();
    if (res.granted) setScanning(true);
    else setMessage('Necesitamos la cámara para escanear el QR. Puedes escribir el código a mano.');
  };

  if (scanning) {
    return (
      <SafeAreaView style={styles.scannerSafe}>
        <CameraView
          testID="qr-camera"
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => { if (busy) return; setScanning(false); join(data); }}
        />
        <View style={styles.scannerOverlay}><View style={styles.scannerFrame} /><Text style={styles.scannerHint}>Apunta al código QR del padre/madre</Text></View>
        <Pressable testID="scanner-cancel" style={styles.scannerCancel} onPress={() => setScanning(false)}>
          <Ionicons name="close" size={22} color={C.paper} />
          <Text style={styles.scannerCancelText}>Cancelar</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.authSafe}>
      <ScrollView contentContainerStyle={styles.authWrap} keyboardShouldPersistTaps="handled">
        <Pressable testID="join-back" onPress={onBack} style={styles.backRow}>
          <Ionicons name="chevron-back" size={20} color={C.forest} />
          <Text style={styles.linkText}>Volver</Text>
        </Pressable>
        <View style={styles.brandRow}>
          <View style={[styles.brandMark, { backgroundColor: C.terracotta }]}><Ionicons name="phone-portrait-outline" color={C.paper} size={22} /></View>
          <Text style={styles.brand}>TimeGuard</Text>
        </View>
        <Text style={styles.eyebrow}>DISPOSITIVO MONITORIZADO</Text>
        <Text style={styles.heroTitle}>Únete a tu familia.</Text>
        <Text style={styles.heroCopy}>Pide el código a tu padre o madre desde su app y escríbelo aquí, o escanea el QR.</Text>
        <View style={styles.authCard}>
          <Text style={styles.cardTitle}>Introducir código</Text>
          <TextInput
            testID="join-code"
            style={[styles.input, styles.codeInput]}
            placeholder="ABC123"
            placeholderTextColor={C.muted}
            autoCapitalize="characters"
            maxLength={6}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
          />
          {!!message && <Text style={styles.formMessage}>{message}</Text>}
          <Pressable testID="join-submit" style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => join(code)} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? 'Uniéndose…' : 'Unirme a la familia'}</Text>
            {busy && <ActivityIndicator color={C.paper} />}
          </Pressable>
          <Pressable testID="join-scan" style={styles.secondaryButton} onPress={openScanner}>
            <Ionicons name="qr-code-outline" size={18} color={C.forest} />
            <Text style={styles.secondaryText}>Escanear QR</Text>
          </Pressable>
          {permission && !permission.granted && !permission.canAskAgain && (
            <Pressable testID="open-settings" style={styles.linkButton} onPress={() => Linking.openSettings()}>
              <Text style={styles.linkText}>Abrir Ajustes para activar la cámara</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
