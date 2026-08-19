import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { getMonitoredDevice } from '@/src/lib/pairing';
import { syncUsageToSupabase, usageAvailable } from '@/src/lib/nativeUsage';

export const USAGE_SYNC_TASK = 'timeguard-usage-sync';

// Defined at module import (global scope) so the OS can invoke it while the app is backgrounded.
// The Supabase session and monitored device id are restored from persistent storage.
if (Platform.OS !== 'web') {
  try {
    TaskManager.defineTask(USAGE_SYNC_TASK, async () => {
      try {
        if (!usageAvailable) return BackgroundTask.BackgroundTaskResult.Success;
        const dev = await getMonitoredDevice();
        if (dev?.deviceId) await syncUsageToSupabase(dev.deviceId);
        return BackgroundTask.BackgroundTaskResult.Success;
      } catch {
        return BackgroundTask.BackgroundTaskResult.Failed;
      }
    });
  } catch {
    // defineTask can only run once; ignore duplicate-definition errors on fast refresh.
  }
}

export async function registerUsageSync() {
  if (Platform.OS === 'web' || !usageAvailable) return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
    const registered = await TaskManager.isTaskRegisteredAsync(USAGE_SYNC_TASK);
    if (!registered) {
      // 15 min is the OS-enforced minimum; the system may run it less frequently.
      await BackgroundTask.registerTaskAsync(USAGE_SYNC_TASK, { minimumInterval: 15 });
    }
  } catch {
    // no-op: background sync is best-effort
  }
}

export async function unregisterUsageSync() {
  if (Platform.OS === 'web') return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(USAGE_SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(USAGE_SYNC_TASK);
    }
  } catch {
    // no-op
  }
}
