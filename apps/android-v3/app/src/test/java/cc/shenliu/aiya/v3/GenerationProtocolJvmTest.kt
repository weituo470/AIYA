package cc.shenliu.aiya.v3


import org.junit.Assert.*
import org.junit.Test



class GenerationProtocolJvmTest {
    @Test fun successRequiresPlayableHtml() {
        val reply = parseGenerationReply(200, """{"ok":true,"result":{"html":"<h1>ready</h1>"}}""", false)
        assertEquals(GenerationReplyKind.Complete, reply.kind)
        assertEquals(GenerationReplyKind.Transient, parseGenerationReply(200, """{"ok":true}""", false).kind)
    }
    @Test fun pendingShowsActualStageAndTrace() {
        val reply = parseGenerationReply(202, """{"ok":true,"pending":true,"stage":"browser_validation","build":{"taskId":"test"}}""", true)
        assertEquals(GenerationReplyKind.Pending, reply.kind)
        assertTrue(reply.progress.buildJson.contains("test"))
        assertTrue(reply.progress.message.contains("浏览器"))
    }
    @Test fun htmlProxyErrorIsTransientButAuditedFailureIsTerminal() {
        assertEquals(GenerationReplyKind.Transient, parseGenerationReply(502, "<h1>bad gateway</h1>", false).kind)
        val r=parseGenerationReply(502,"""{"ok":false,"error":"test failed","diagnosticId":"test","build":{"taskId":"test"}}""",false)
        assertEquals(GenerationReplyKind.Failed,r.kind)
        assertTrue(r.progress.message.contains("test failed")); assertTrue(r.progress.buildJson.contains("test"))
    }
    @Test fun onlyPolling404WaitsForAcceptance() {
        assertEquals(GenerationReplyKind.NotAccepted,parseGenerationReply(404,"""{"ok":false}""",true).kind)
        assertEquals(GenerationReplyKind.Failed,parseGenerationReply(404,"""{"ok":false}""",false).kind)
    }
    @Test fun backendRejectionStopsImmediately() {
        assertEquals(GenerationReplyKind.Failed,parseGenerationReply(422,"""{"ok":false,"error":"unsupported backend"}""",false).kind)
    }
    @Test fun legacyTraceDoesNotInventTests() {
        assertTrue(generationTraceLines("").single().second.contains("不能据此判断已测试"))
    }
    @Test fun traceShowsBothCallsAndTestingBoundary() {
        val lines=generationTraceLines("""{"taskId":"test","model":{"returned":"deepseek-flash"},"calls":[{"model":"gpt-6-astra","status":"failed","durationMs":90000},{"model":"deepseek-flash","status":"succeeded","durationMs":8000}],"validations":[{"status":"passed","coverage":"smoke-only"}]}""")
        assertTrue(lines.any{it.second.contains("gpt-6-astra")&&it.second.contains("失败")})
        assertTrue(lines.any{it.second.contains("deepseek-flash")})
        assertTrue(lines.any{it.second.contains("smoke-only")})
        assertTrue(lines.last().second.contains("不等于完整验收"))
    }
}
