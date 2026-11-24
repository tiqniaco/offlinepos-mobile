package expo.modules.driveshare

import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val DRIVE = "com.google.android.apps.docs"

/**
 * Sends one file straight to the Google Drive app ("Upload to Drive" screen), without the system share sheet.
 * The file is given as a content:// URI (expo-file-system's provider) with a temporary read grant.
 */
class DriveShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DriveShare")

    Function("isDriveInstalled") {
      val ctx = appContext.reactContext ?: return@Function false
      try {
        ctx.packageManager.getPackageInfo(DRIVE, 0)
        true
      } catch (e: PackageManager.NameNotFoundException) {
        false
      }
    }

    Function("sendToDrive") { contentUri: String, mime: String, title: String ->
      val activity = appContext.currentActivity ?: return@Function false
      val uri = Uri.parse(contentUri)
      val send = Intent(Intent.ACTION_SEND).apply {
        setPackage(DRIVE)
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, title)
        putExtra(Intent.EXTRA_SUBJECT, title)
        clipData = ClipData.newRawUri(title, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      try {
        activity.startActivity(send)
        true
      } catch (e: Exception) {
        false
      }
    }
  }
}
