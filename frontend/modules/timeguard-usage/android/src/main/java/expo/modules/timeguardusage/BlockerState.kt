package expo.modules.timeguardusage

// Shared state read by the AccessibilityService and written by the module / prefs.
object BlockerState {
  @Volatile var enabled: Boolean = false
  @Volatile var allowed: Set<String> = emptySet()
}
