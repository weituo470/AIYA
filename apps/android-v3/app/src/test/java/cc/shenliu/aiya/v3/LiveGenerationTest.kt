package cc.shenliu.aiya.v3

import java.io.File
import java.net.URLEncoder
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Explicit opt-in only. Real paid providers, Kotlin transport on JVM, not phone UI. */
class LiveGenerationTest {
    @Test(timeout = 650_000L) fun realMobileContractCreateAndRecover() {
        assumeTrue("Paid integration opt-in required", System.getenv("AIYA_APK_LIVE_TEST") == "1")
        val output = File(System.getenv("AIYA_APK_LIVE_OUTPUT") ?: error("Missing evidence directory"))
        output.mkdirs()
        val endpoint = "https://aiya.shenliu.cc/api/teacher-coder"
        val device = "android-codex-kotlin-test-${UUID.randomUUID()}"
        val records = JSONArray()
        fun save() { File(output, "live-kotlin.json").writeText(JSONObject()
            .put("scope", "Real public providers + actual Kotlin HTTP/recovery code on JVM; not Android device")
            .put("records", records).toString(2)) }
        val samples = listOf(
            "speed" to "做一个计算器，支持加减乘除、小数、清空和退格，除以零显示友好错误。正文18px，控件16px。",
            "auto" to "做一个两页任务看板：任务页和统计页。可以添加任务，使用标准复选框完成任务，删除任务。统计页显示准确总数和完成数。有任务、统计两个切换按钮。正文18px，控件16px，按钮44px，390px宽不溢出。",
        )
        for ((preference, idea) in samples) {
            val taskId = "apk-kotlin-${UUID.randomUUID()}"
            val payload = JSONObject().put("idea", idea).put("buildPreference", preference)
                .put("modelSelectionMode", "auto").put("modelMode", "default")
                .put("deviceContext", JSONObject().put("surface", "mobile").put("touch", true).put("isApk", true))
                .put("taskContext", JSONObject().put("source", "android-v3").put("clientTaskId", taskId)
                    .put("deviceId", device).put("userId", "android:$device").put("userName", "Codex APK Kotlin回归")
                    .put("appId", "cc.shenliu.aiya.v3").put("appVersion", "0.6.65 (71)"))
            val recoveryUrl = "$endpoint?clientTaskId=${URLEncoder.encode(taskId,"UTF-8")}&deviceId=${URLEncoder.encode(device,"UTF-8")}"
            var posts = 0; var polls = 0; val progress = JSONArray(); val start = System.nanoTime()
            try {
                val json = awaitRecoverableGeneration(submit = { posts++; exchangeGenerationHttp(endpoint, payload.toString()) },
                    poll = { remaining -> polls++; exchangeGenerationHttp(recoveryUrl, remainingMs = remaining) },
                    onProgress = { p -> if (progress.length() == 0 || progress.optString(progress.length()-1) != p.message) progress.put(p.message) })
                val build = json.getJSONObject("build")
                val artifact = json.getJSONObject("result")
                assertTrue(artifact.getString("html").isNotBlank()); assertEquals(1, posts)
                val checks=build.getJSONArray("checks")
                assertTrue((0 until checks.length()).any { checks.getJSONObject(it).optString("name") == "browser-runtime" && checks.getJSONObject(it).optString("status") == "passed" })
                records.put(JSONObject().put("preference",preference).put("passed",true).put("posts",posts).put("polls",polls)
                    .put("wallMs",(System.nanoTime()-start)/1_000_000).put("progress",progress).put("build",build))
                File(output, "${preference}-artifact.html").writeText(artifact.getString("html"))
                save()
                // Re-query the same completed task; never submit again to recover.
                assertEquals(artifact.getString("html"),exchangeGenerationHttp(recoveryUrl).result!!.getJSONObject("result").getString("html"))
            } catch (error: Throwable) {
                records.put(JSONObject().put("preference",preference).put("passed",false).put("error",error.message).put("posts",posts).put("polls",polls));save();throw error
            }
        }
        val rejection=exchangeGenerationHttp(endpoint,JSONObject().put("idea","接入真实服务器实现跨设备同步")
            .put("buildPreference","auto").put("taskContext",JSONObject().put("source","android-v3").put("deviceId",device)).toString())
        assertEquals(GenerationReplyKind.Failed,rejection.kind)
        assertEquals(0,JSONObject(rejection.progress.buildJson).getJSONArray("calls").length())
        File(output,"backend-boundary.json").writeText(rejection.progress.buildJson)
    }
}
