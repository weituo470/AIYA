package cc.shenliu.aiya.v3

import java.net.URLEncoder
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Read-only, opt-in acceptance. Never starts a model generation task. */
class LiveTaskRecoveryTest {
    @Test fun completedProductionTaskIsRecoveredThroughApkProtocolThreeTimes() {
        assumeTrue(System.getenv("AIYA_RECOVERY_LIVE") == "1")
        val clientId = requireNotNull(System.getenv("AIYA_RECOVERY_CLIENT_ID"))
        val deviceId = requireNotNull(System.getenv("AIYA_RECOVERY_DEVICE_ID"))
        val url = "https://aiya.shenliu.cc/api/teacher-coder?clientTaskId=" +
            URLEncoder.encode(clientId, "UTF-8") + "&deviceId=" + URLEncoder.encode(deviceId, "UTF-8")
        var originalArtifactId = ""
        repeat(3) {
            val json = awaitRecoverableGeneration(
                submit = { error("This acceptance test must never POST or generate") },
                poll = { exchangeGenerationHttp(url, remainingMs = it) },
                resumeOnly = true,
                timeoutMs = 30_000,
            )
            assertTrue(json.getBoolean("recovered"))
            assertEquals("succeeded", json.getJSONObject("build").getString("status"))
            val result = json.getJSONObject("result")
            assertTrue(result.getString("html").length > 1000)
            if (it == 0) originalArtifactId = result.getString("id")
            assertEquals(originalArtifactId, result.getString("id"))
        }
    }
}
