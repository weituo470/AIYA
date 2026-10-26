package cc.shenliu.aiya.v3

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import androidx.activity.compose.setContent
import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Read-only device check: do not clear, replace or decrypt-export user works. */
@RunWith(AndroidJUnit4::class)
class GeneratedHtmlSafetyDeviceTest {
    @Test fun rejectedPreviewRendersWithoutWebViewAndCanSwitchToSafeWork() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent = Intent(instrumentation.targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as MainActivity
        fun findWebViews(view: View): List<WebView> = when (view) {
            is WebView -> listOf(view)
            is ViewGroup -> (0 until view.childCount).flatMap { findWebViews(view.getChildAt(it)) }
            else -> emptyList()
        }
        try {
            val blocked = "<!doctype html><html><head></head><body><script>fetch('https://example.test')</script></body></html>"
            instrumentation.runOnMainSync { activity.setContent { GeneratedWorkWebView(title = "拦截回归", html = blocked) } }
            SystemClock.sleep(600)
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync { assertTrue("Blocked HTML must not create a WebView", findWebViews(activity.window.decorView).isEmpty()) }

            val safe = "<!doctype html><html><head></head><body><svg xmlns=\"http://www.w3.org/2000/svg\"><circle r=\"10\"/></svg><p>SVG OK</p></body></html>"
            instrumentation.runOnMainSync { activity.setContent { GeneratedWorkWebView(title = "SVG回归", html = safe) } }
            SystemClock.sleep(800)
            instrumentation.waitForIdleSync()
            val completed = CountDownLatch(1)
            var body = ""
            instrumentation.runOnMainSync {
                val views = findWebViews(activity.window.decorView)
                assertEquals(1, views.size)
                views.single().evaluateJavascript("document.body.innerText") { body = it; completed.countDown() }
            }
            assertTrue(completed.await(10, TimeUnit.SECONDS))
            assertTrue(body.contains("SVG OK"))
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test fun existingWorksStillDecryptAndActiveSvgWorkPassesPreview() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val prefs = context.getSharedPreferences("aiya_v3_prefs", 0)
        val works = JSONArray(prefs.getString("work_library_json", "[]"))
        assertTrue("Run this recovery check on the affected phone with saved works", works.length() > 0)
        val activeId = prefs.getString("active_work_id", "")
        val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        var activeChecked = false
        for (index in 0 until works.length()) {
            val work = works.getJSONObject(index)
            val file = File(context.filesDir, "works/${work.getString("id")}.bin")
            val encrypted = EncryptedFile.Builder(context, file, masterKey, EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB).build()
            val bytes = encrypted.openFileInput().use { it.readBytes() }
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            assertEquals("Saved work must be intact", work.getString("htmlHash"), hash)
            if (work.getString("id") == activeId) {
                assertTrue(prepareGeneratedPreview(bytes.toString(Charsets.UTF_8)) { it }.isSuccess)
                activeChecked = true
            }
        }
        assertTrue("Original active work still exists and passes safety check", activeChecked)
    }

    @Test fun realNetworkRequestIsRejectedWithoutCrashing() {
        val html = "<!doctype html><html><head></head><body><script>fetch('https://example.test')</script></body></html>"
        var reachedWebView = false
        val result = prepareGeneratedPreview(html) { reachedWebView = true; it }
        assertTrue(result.isFailure)
        assertFalse(reachedWebView)
    }
}
