package expo.modules.timeguardusage

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.view.accessibility.AccessibilityEvent

// When blocking is enabled, any foreground app that is not TimeGuard, the launcher,
// the keyboard or an explicitly-allowed package is pushed back to the home screen.
class BlockerAccessibilityService : AccessibilityService() {
  override fun onServiceConnected() {
    super.onServiceConnected()
    val prefs = getSharedPreferences("timeguard", Context.MODE_PRIVATE)
    BlockerState.enabled = prefs.getBoolean("blocking", false)
    BlockerState.allowed = prefs.getStringSet("allowed", emptySet()) ?: emptySet()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (!BlockerState.enabled) return
    if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    val pkg = event.packageName?.toString() ?: return

    if (pkg == packageName) return
    if (BlockerState.allowed.contains(pkg)) return
    if (pkg == "com.android.systemui") return
    if (pkg.contains("launcher", ignoreCase = true)) return
    if (pkg.contains("inputmethod", ignoreCase = true)) return

    performGlobalAction(GLOBAL_ACTION_HOME)
  }

  override fun onInterrupt() {}
}
