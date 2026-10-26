package cc.shenliu.aiya.v3

import java.io.File
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Paid, explicit opt-in. Tests actual APK transport on JVM, not phone hardware. */
class LiveGoldenKeyTest {
    @Test(timeout=1_800_000L) fun generateAllSixViaPublicService() {
        assumeTrue(System.getenv("AIYA_GOLDEN_KEY_LIVE")=="1")
        val out=File(System.getenv("AIYA_GOLDEN_KEY_OUTPUT") ?: error("Missing receipt directory"));out.mkdirs()
        val selected=System.getenv("AIYA_GOLDEN_KEY_IDS")?.split(",")
        val catalog=parseGoldenKeyCatalog(File("src/main/assets/golden-key.json").readText()).filter { selected==null || it.id in selected }
        require(catalog.isNotEmpty())
        val endpoint="https://aiya.shenliu.cc/api/teacher-coder"
        val pool=Executors.newFixedThreadPool(2)
        try {
            val futures=catalog.map { e -> pool.submit<Boolean> {
                val task="golden-key-${UUID.randomUUID()}"
                val device="android-codex-golden-${UUID.randomUUID()}"
                val payload=JSONObject().put("idea",e.prompt).put("buildPreference","auto")
                    .put("modelMode","default").put("modelSelectionMode","auto")
                    .put("deviceContext",JSONObject().put("surface","mobile").put("pointer","coarse").put("touch",true).put("isApk",true))
                    .put("taskContext",JSONObject().put("source","android-v3").put("clientTaskId",task)
                        .put("deviceId",device).put("userId","android:$device").put("userName","Codex金钥匙回归")
                        .put("appId","cc.shenliu.aiya.v3").put("appVersion","0.6.66 (72)"))
                val url="$endpoint?clientTaskId=${URLEncoder.encode(task,"UTF-8")}&deviceId=${URLEncoder.encode(device,"UTF-8")}"
                var posts=0;var polls=0;val start=System.nanoTime()
                val receipt=JSONObject().put("id",e.id).put("title",e.title).put("scope","APK Kotlin HTTP on JVM; no real-phone/hardware verification").put("promptSha256",java.security.MessageDigest.getInstance("SHA-256").digest(e.prompt.toByteArray()).joinToString("") { "%02x".format(it) })
                File(out,"${e.id}.json").writeText(receipt.put("status","running").toString(2))
                try {
                    val json=awaitRecoverableGeneration(submit={posts++;exchangeGenerationHttp(endpoint,payload.toString())},
                        poll={remaining->polls++;exchangeGenerationHttp(url,remainingMs=remaining)},
                        onProgress={progress ->
                            receipt.put("progress",progress.message)
                            if(progress.buildJson.isNotBlank())receipt.put("build",JSONObject(progress.buildJson))
                            File(out,"${e.id}.json").writeText(receipt.toString(2))
                        })
                    val build=json.getJSONObject("build");val html=json.getJSONObject("result").getString("html")
                    val checks=build.getJSONArray("checks")
                    val passed=html.isNotBlank() && posts==1 && (0 until checks.length()).any {
                        checks.getJSONObject(it).optString("name")=="browser-runtime" && checks.getJSONObject(it).optString("status")=="passed"
                    }
                    receipt.put("passed",passed).put("build",build)
                    File(out,"${e.id}.html").writeText(html)
                    receipt.put("artifactBytes",html.toByteArray().size)
                    passed
                } catch (error:Throwable) {
                    receipt.put("passed",false).put("error",error.message)
                    if(error is GenerationTaskFailure && error.buildJson.isNotBlank())receipt.put("build",JSONObject(error.buildJson))
                    false
                } finally {
                    receipt.put("status","finished").put("posts",posts).put("polls",polls).put("durationMs",(System.nanoTime()-start)/1_000_000)
                    File(out,"${e.id}.json").writeText(receipt.toString(2))
                }
            } }
            val results=futures.map { it.get() }
            assertEquals("Some catalog generations failed; see per-sample receipts",catalog.size,results.count { it })
        } finally { pool.shutdownNow() }
    }
}
