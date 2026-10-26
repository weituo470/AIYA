package cc.shenliu.aiya.v3

import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import java.net.InetSocketAddress
import org.junit.Assert.*
import org.junit.Test

class GenerationHttpTest {
    private fun withServer(handler: (String, Int) -> Pair<Int, String>, test: (String, () -> Int) -> Unit) {
        val posts = AtomicInteger(0)
        val failure = AtomicReference<Throwable>()
        val server = ServerSocket(0, 8, java.net.InetAddress.getByName("127.0.0.1"))
        val worker = Thread {
            try {
                while (!server.isClosed) server.accept().use { socket ->
                    socket.soTimeout = 5000
                    val input = socket.getInputStream()
                    val header = StringBuilder()
                    while (!header.endsWith("\r\n\r\n")) {
                        val byte = input.read()
                        check(byte >= 0 && header.length < 16384) { "Invalid HTTP header" }
                        header.append(byte.toChar())
                    }
                    val lines = header.toString().split("\r\n")
                    val method = lines[0].substringBefore(' ')
                    val size = lines.firstOrNull { it.startsWith("Content-Length:", true) }
                        ?.substringAfter(':')?.trim()?.toInt() ?: 0
                    repeat(size) { check(input.read() >= 0) }
                    if (method == "POST") posts.incrementAndGet()
                    val (status, text) = handler(method, posts.get())
                    if (status != 0) {
                        val bytes = text.toByteArray(Charsets.UTF_8)
                        val output = socket.getOutputStream()
                        output.write("HTTP/1.1 $status Test\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        output.write(bytes); output.flush()
                    }
                }
            } catch (error: Throwable) { if (!server.isClosed) failure.set(error) }
        }.apply { isDaemon = true; start() }
        try { test("http://127.0.0.1:${server.localPort}/task") { posts.get() } }
        finally { server.close(); worker.join(1000) }
        failure.get()?.let { throw AssertionError("HTTP fixture failed", it) }
    }

    @Test fun proxyFailurePollsOnePostThroughActualHttp() {
        var polls = 0; var clock = 0L
        withServer({ method, _ ->
            if (method == "POST") 502 to "<h1>proxy</h1>"
            else { polls++; when (polls) {
                1 -> 404 to """{"ok":false}"""
                2 -> 202 to """{"ok":true,"pending":true,"stage":"calling_model"}"""
                else -> 200 to """{"ok":true,"result":{"html":"<button>ready</button>"}}"""
            } }
        }) { url, posts ->
            val result = awaitRecoverableGeneration(submit = { exchangeGenerationHttp(url, "{}") },
                poll = { exchangeGenerationHttp(url, remainingMs = it) }, now = { clock }, sleep = { clock += it })
            assertTrue(result.getJSONObject("result").getString("html").contains("ready"))
            assertEquals(1, posts()); assertEquals(3, polls)
        }
    }
    @Test fun lostSocketDoesNotReplayPost() {
        var clock = 0L
        withServer({ method, _ -> if (method == "POST") 0 to "" else
            200 to """{"ok":true,"result":{"html":"recovered"}}""" }) { url, posts ->
            val result = awaitRecoverableGeneration(submit = { exchangeGenerationHttp(url, "{}") },
                poll = { exchangeGenerationHttp(url, remainingMs = it) }, now = { clock }, sleep = { clock += it })
            assertEquals("recovered", result.getJSONObject("result").getString("html")); assertEquals(1, posts())
        }
    }
    @Test fun auditedFunctionalFailureDoesNotGetPolled() {
        withServer({ _, _ -> 502 to """{"ok":false,"error":"incorrect calculation","build":{"taskId":"test"}}""" }) { url, posts ->
            try {
                awaitRecoverableGeneration(submit = { exchangeGenerationHttp(url, "{}") }, poll = { error("must not poll") })
                fail("must fail")
            } catch (e: GenerationTaskFailure) { assertEquals(1, posts()); assertTrue(e.buildJson.contains("test")) }
        }
    }
    @Test fun stageUsesReportedModelFailureNotInventedThinking() {
        val r=parseGenerationReply(202,"""{"ok":true,"pending":true,"stage":"switching_model"}""",true)
        assertTrue(r.progress.message.contains("失败")); assertTrue(r.progress.message.contains("备用"))
    }
    @Test fun realHttpResumeAfterOfflineDeadlineHasOnlyOnePostAndRecoversHtml() {
        var clock = 0L; var recovered = false
        withServer({ method, _ ->
            if (method == "POST") 202 to """{"ok":true,"pending":true}"""
            else if (!recovered) 502 to "<h1>disconnected</h1>"
            else 200 to """{"ok":true,"recovered":true,"result":{"id":"original","title":"星际守卫","html":"<button>开始</button>"},"build":{"status":"succeeded"}}"""
        }) { url, posts ->
            try {
                awaitRecoverableGeneration(submit = { exchangeGenerationHttp(url, "{}") },
                    poll = { exchangeGenerationHttp(url, remainingMs = it) }, timeoutMs = 6_000,
                    now = { clock }, sleep = { clock += it })
                fail("Must remain uncertain")
            } catch (_: GenerationResultUncertain) { }
            recovered = true
            val result = awaitRecoverableGeneration(submit = { exchangeGenerationHttp(url, "{}") },
                poll = { exchangeGenerationHttp(url, remainingMs = it) }, resumeOnly = true)
            assertEquals("星际守卫", result.getJSONObject("result").getString("title"))
            assertEquals("original", result.getJSONObject("result").getString("id"))
            assertEquals(1, posts())
        }
    }
}
