package expo.modules.timeguardusage

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Process
import android.provider.Settings
import android.text.TextUtils
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TimeguardUsageModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is null")

  override fun definition() = ModuleDefinition {
    Name("TimeguardUsage")

    // Whether the special "Usage access" permission was granted in system settings.
    Function("hasUsageAccess") {
      val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        context.packageName
      )
      mode == AppOpsManager.MODE_ALLOWED
    }

    Function("openUsageAccessSettings") {
      val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }

    // Returns per-app foreground minutes since `sinceMs` (epoch millis).
    AsyncFunction("getUsage") { sinceMs: Double ->
      val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val end = System.currentTimeMillis()
      val begin = sinceMs.toLong()
      val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, begin, end)
      val pm = context.packageManager
      val merged = HashMap<String, Long>()
      stats?.forEach { s ->
        if (s.totalTimeInForeground > 0) {
          merged[s.packageName] = (merged[s.packageName] ?: 0L) + s.totalTimeInForeground
        }
      }
      val result = ArrayList<Map<String, Any>>()
      merged.forEach { (pkg, ms) ->
        val minutes = (ms / 60000L).toInt()
        if (minutes > 0) {
          val appName = try {
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
          } catch (e: Exception) {
            pkg
          }
          result.add(mapOf("packageName" to pkg, "appName" to appName, "minutes" to minutes))
        }
      }
      result
    }

    // Returns launchable installed apps (excluding TimeGuard itself).
    AsyncFunction("getInstalledApps") {
      val pm = context.packageManager
      val intent = Intent(Intent.ACTION_MAIN, null).apply { addCategory(Intent.CATEGORY_LAUNCHER) }
      val activities = pm.queryIntentActivities(intent, 0)
      val seen = HashSet<String>()
      val result = ArrayList<Map<String, Any>>()
      activities.forEach { ri ->
        val pkg = ri.activityInfo.packageName
        if (pkg != context.packageName && seen.add(pkg)) {
          val label = try { ri.loadLabel(pm).toString() } catch (e: Exception) { pkg }
          result.add(mapOf("packageName" to pkg, "appName" to label))
        }
      }
      result
    }

    Function("isAccessibilityEnabled") {
      isAccessibilityServiceEnabled()
    }

    Function("openAccessibilitySettings") {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(intent)
    }

    // Enable/disable enforcement. `allowedPackages` are never pushed to home.
    Function("setBlocking") { enabled: Boolean, allowedPackages: List<String> ->
      BlockerState.enabled = enabled
      BlockerState.allowed = allowedPackages.toSet()
      context.getSharedPreferences("timeguard", Context.MODE_PRIVATE)
        .edit()
        .putBoolean("blocking", enabled)
        .putStringSet("allowed", allowedPackages.toSet())
        .apply()
    }
  }

  private fun isAccessibilityServiceEnabled(): Boolean {
    val expected = context.packageName + "/" + BlockerAccessibilityService::class.java.name
    val enabled = Settings.Secure.getString(
      context.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    val splitter = TextUtils.SimpleStringSplitter(':')
    splitter.setString(enabled)
    while (splitter.hasNext()) {
      if (splitter.next().equals(expected, ignoreCase = true)) return true
    }
    return false
  }
}
