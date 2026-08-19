import { Ionicons } from '@expo/vector-icons';
import { Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';

import styles from '@/src/styles/timeguard';
import { C } from '@/src/theme';

export default function Landing({ onParent, onMonitored }: { onParent: () => void; onMonitored: () => void }) {
  return (
    <SafeAreaView style={styles.authSafe}>
      <ScrollView contentContainerStyle={styles.landingWrap}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}><Ionicons name="shield-checkmark" color={C.paper} size={22} /></View>
          <Text style={styles.brand}>TimeGuard</Text>
        </View>
        <Text style={styles.eyebrow}>CONTROL FAMILIAR · ANDROID</Text>
        <Text style={styles.heroTitle}>¿Cómo vas a usar este dispositivo?</Text>
        <Text style={styles.heroCopy}>Elige un rol para empezar. Podrás cambiarlo más adelante.</Text>

        <Pressable testID="role-parent" onPress={onParent} style={({ pressed }) => [styles.choiceCard, pressed && styles.pressed]}>
          <View style={[styles.choiceIcon, { backgroundColor: C.forest }]}><Ionicons name="people-outline" size={26} color={C.paper} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.choiceTitle}>Soy padre / madre</Text>
            <Text style={styles.choiceCopy}>Crea tu familia, vincula dispositivos y gestiona límites.</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={C.muted} />
        </Pressable>

        <Pressable testID="role-monitored" onPress={onMonitored} style={({ pressed }) => [styles.choiceCard, pressed && styles.pressed]}>
          <View style={[styles.choiceIcon, { backgroundColor: C.terracotta }]}><Ionicons name="phone-portrait-outline" size={26} color={C.paper} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.choiceTitle}>Soy el dispositivo monitorizado</Text>
            <Text style={styles.choiceCopy}>Únete a tu familia con el código o el QR del padre/madre.</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={C.muted} />
        </Pressable>

        <Text style={styles.privacy}><Ionicons name="lock-closed" size={13} color={C.muted} /> Tus datos familiares están protegidos con Supabase.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
