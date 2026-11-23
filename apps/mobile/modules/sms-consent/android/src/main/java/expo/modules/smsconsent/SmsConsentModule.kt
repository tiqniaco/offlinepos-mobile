package expo.modules.smsconsent

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CONSENT_REQUEST_CODE = 0x5C0D // only this module's own startActivityForResult
private const val GMS_PACKAGE = "com.google.android.gms"

/** First standalone 6-digit run in the SMS; Arabic-Indic (٠-٩) and Persian (۰-۹) digits count too. */
internal object OtpParser {
  private val SIX = Regex("(?<![0-9])[0-9]{6}(?![0-9])")

  fun normalizeDigits(text: String): String {
    val out = StringBuilder(text.length)
    for (c in text) {
      out.append(
        when (c) {
          in '٠'..'٩' -> '0' + (c - '٠')
          in '۰'..'۹' -> '0' + (c - '۰')
          else -> c
        }
      )
    }
    return out.toString()
  }

  fun extract(message: String?): String? = message?.let { SIX.find(normalizeDigits(it))?.value }
}

/**
 * Google SMS User Consent API: after start(), the next SMS that contains a code (from a sender that is not in the
 * user's contacts, within 5 minutes) makes Play services show a system sheet "allow the app to read this one
 * message?". On "Allow" the code is extracted and sent to JS as `onCode`. The app never holds READ_SMS/RECEIVE_SMS.
 */
class SmsConsentModule : Module() {
  private var receiver: BroadcastReceiver? = null
  private var pendingConsent: Intent? = null
  private var inForeground = true

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SmsConsent")

    Events("onCode")

    AsyncFunction("start") { promise: Promise ->
      val ctx = context
      // Restart = a fresh 5-minute window (e.g. after "resend code").
      unregister()
      pendingConsent = null
      register(ctx)
      SmsRetriever.getClient(ctx).startSmsUserConsent(null)
        .addOnSuccessListener { promise.resolve(null) }
        .addOnFailureListener { e ->
          unregister()
          promise.reject(CodedException("ERR_SMS_CONSENT", e.message ?: "SMS user consent unavailable", e))
        }
    }

    Function("stop") {
      unregister()
      pendingConsent = null
    }

    OnActivityEntersForeground {
      inForeground = true
      pendingConsent?.let {
        pendingConsent = null
        launchConsent(it)
      }
    }

    OnActivityEntersBackground {
      inForeground = false
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != CONSENT_REQUEST_CODE) return@OnActivityResult
      if (payload.resultCode != Activity.RESULT_OK) return@OnActivityResult // user tapped "Deny"
      val code = OtpParser.extract(payload.data?.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE))
      if (code != null) sendEvent("onCode", Bundle().apply { putString("code", code) })
    }

    OnDestroy {
      unregister()
      pendingConsent = null
    }
  }

  private fun register(ctx: Context) {
    val r = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, intent: Intent?) {
        if (intent?.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
        val extras = intent.extras ?: return
        @Suppress("DEPRECATION")
        val status = extras.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
        // One SMS (or the 5-minute timeout) ends the session either way.
        unregister()
        if (status.statusCode != CommonStatusCodes.SUCCESS) return
        @Suppress("DEPRECATION")
        val consent = extras.getParcelable<Intent>(SmsRetriever.EXTRA_CONSENT_INTENT) ?: return
        if (inForeground) launchConsent(consent) else pendingConsent = consent
      }
    }
    val filter = IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION)
    // Exported (Play services sends it) but only senders holding SEND_PERMISSION (= Play services) can deliver.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ctx.registerReceiver(r, filter, SmsRetriever.SEND_PERMISSION, null, Context.RECEIVER_EXPORTED)
    } else {
      ctx.registerReceiver(r, filter, SmsRetriever.SEND_PERMISSION, null)
    }
    receiver = r
  }

  private fun unregister() {
    val r = receiver ?: return
    receiver = null
    try {
      appContext.reactContext?.unregisterReceiver(r)
    } catch (_: IllegalArgumentException) {
      // already unregistered
    }
  }

  private fun launchConsent(consent: Intent) {
    // Intent-redirection guard: only Play services' own consent screen, and never with URI grants.
    val pkg = consent.component?.packageName ?: consent.`package` ?: consent.resolveActivity(context.packageManager)?.packageName
    val grants = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    if (pkg != GMS_PACKAGE || consent.flags and grants != 0) return
    val activity = appContext.currentActivity
    if (activity == null) {
      pendingConsent = consent
      return
    }
    try {
      activity.startActivityForResult(consent, CONSENT_REQUEST_CODE)
    } catch (_: Exception) {
      // Activity not found / background start blocked: the user can still type the code.
    }
  }
}
