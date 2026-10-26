package cc.shenliu.aiya.v3

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class RecoverableGenerationTest {
    @Test fun immediateSuccessDoesNotPoll() {
        assertEquals("html", awaitRecoverableGeneration(submit = {
            GenerationReply(GenerationReplyKind.Complete, "html")
        }, poll = { error("Must not poll") }))
    }
    @Test fun lostPostRecoversWithoutResubmission() {
        var posts = 0; var polls = 0; var clock = 0L
        val result = awaitRecoverableGeneration<String>(submit = { posts++; throw IOException("lost") },
            poll = { polls++; if (polls < 3) GenerationReply(GenerationReplyKind.Pending)
                else GenerationReply(GenerationReplyKind.Complete, "html") },
            now = { clock }, sleep = { clock += it })
        assertEquals("html", result); assertEquals(1, posts); assertEquals(3, polls)
    }
    @Test fun accepts404AndProxyFailureWhileServerAccepts() {
        var polls = 0; var clock = 0L
        val result = awaitRecoverableGeneration(submit = { GenerationReply<String>(GenerationReplyKind.Transient) },
            poll = { polls++; when (polls) {
                1 -> GenerationReply(GenerationReplyKind.NotAccepted)
                2 -> throw IOException("proxy lost")
                else -> GenerationReply(GenerationReplyKind.Complete, "same task")
            } }, now = { clock }, sleep = { clock += it })
        assertEquals("same task", result); assertEquals(3, polls)
    }
    @Test fun taskCanRemainPendingLongerThanOneMinute() {
        var polls = 0; var clock = 0L
        val result = awaitRecoverableGeneration(submit = { GenerationReply<String>(GenerationReplyKind.Pending) },
            poll = { polls++; if (clock < 180_000) GenerationReply(GenerationReplyKind.Pending)
                else GenerationReply(GenerationReplyKind.Complete, "finished") },
            now = { clock }, sleep = { clock += it })
        assertEquals("finished", result); assertEquals(90, polls)
    }
    @Test fun definitiveFailureStopsAndPreservesTrace() {
        try {
            awaitRecoverableGeneration<String>(submit = { GenerationReply(GenerationReplyKind.Failed,
                progress = GenerationProgress("runtime failed", "trace")) }, poll = { error("Must not poll") })
            fail("Must fail")
        } catch (e: GenerationTaskFailure) { assertEquals("runtime failed", e.message); assertEquals("trace", e.buildJson) }
    }
    @Test fun failedPollDoesNotLoopOrLoseTrace() {
        var clock = 0L; var polls = 0
        try {
            awaitRecoverableGeneration<String>(submit = { GenerationReply(GenerationReplyKind.Pending,
                progress = GenerationProgress("checking", "original trace")) },
                poll = { polls++; GenerationReply(GenerationReplyKind.Failed, progress = GenerationProgress("failed")) },
                now = { clock }, sleep = { clock += it })
            fail("Must fail")
        } catch (e: GenerationTaskFailure) { assertEquals(1, polls); assertEquals("original trace", e.buildJson) }
    }
    @Test fun recoveryHasFiniteWallClockBudget() {
        var clock = 0L; var posts = 0
        try {
            awaitRecoverableGeneration<String>(submit = { posts++; throw IOException("offline") },
                poll = { GenerationReply(GenerationReplyKind.NotAccepted) }, timeoutMs = 9_000,
                now = { clock }, sleep = { clock += it })
            fail("Must fail")
        } catch (e: GenerationResultUncertain) {
            assertEquals(1, posts); assertEquals(9_000L, clock)
            assertTrue(e.message!!.contains("尚不能判断生成失败"))
        }
    }
    @Test fun resumeAfterTimeoutNeverSubmitsAgainAndKeepsTrace() {
        var posts = 0; var polls = 0; var clock = 0L
        val result = awaitRecoverableGeneration(submit = { posts++; error("No POST on resume") },
            poll = { polls++; if (polls == 1) GenerationReply<String>(GenerationReplyKind.Transient)
                else GenerationReply(GenerationReplyKind.Complete, "original work") },
            resumeOnly = true, initialProgress = GenerationProgress("recovering", "original trace"),
            now = { clock }, sleep = { clock += it })
        assertEquals("original work", result); assertEquals(0, posts); assertEquals(2, polls)
    }
    @Test fun offlineRecoveryRemainsUncertainInsteadOfServerFailure() {
        var clock = 0L
        try {
            awaitRecoverableGeneration<String>(submit = { error("Must not submit") },
                poll = { throw IOException("network unavailable") }, resumeOnly = true,
                timeoutMs = 6_000, initialProgress = GenerationProgress("recovering", "saved trace"),
                now = { clock }, sleep = { clock += it })
            fail("Must remain recoverable")
        } catch (e: GenerationResultUncertain) {
            assertEquals("saved trace", e.buildJson)
            assertTrue(e.message!!.contains("network unavailable"))
        }
    }
    @Test fun originalTaskCanFinishAfterClientDeadlineAndBeRecovered() {
        var posts = 0; var clock = 0L; var complete = false
        val submit = { posts++; GenerationReply<String>(GenerationReplyKind.Pending) }
        val poll = { _: Long -> if (complete) GenerationReply(GenerationReplyKind.Complete, "finished HTML")
            else GenerationReply<String>(GenerationReplyKind.Pending) }
        try {
            awaitRecoverableGeneration(submit, poll, timeoutMs = 4_000, now = { clock }, sleep = { clock += it })
            fail("Must reach client deadline")
        } catch (_: GenerationResultUncertain) { }
        complete = true
        assertEquals("finished HTML", awaitRecoverableGeneration(submit, poll, resumeOnly = true))
        assertEquals(1, posts)
    }
    @Test fun legacyTimeoutMigratesButAuditedFailureAndCancellationDoNot() {
        assertTrue(generationNeedsRecovery("failed", "原任务等待已达9分钟上限，未自动重新提交。"))
        assertTrue(generationNeedsRecovery("awaiting-result", "offline"))
        assertTrue(generationNeedsRecovery("running", "pending"))
        assertFalse(generationNeedsRecovery("failed", "invalid calculation"))
        assertFalse(generationNeedsRecovery("cancelled", "原任务等待已达9分钟上限"))
        assertFalse(generationNeedsRecovery("succeeded", "finished"))
    }
    @Test fun resumeBudgetDoesNotResetOriginalNineMinuteWait() {
        assertEquals(540_000L, generationRecoveryBudgetMs(1_000L, 1_000L))
        assertEquals(240_000L, generationRecoveryBudgetMs(1_000L, 301_000L))
        assertEquals(30_000L, generationRecoveryBudgetMs(1_000L, 541_000L))
        assertEquals(30_000L, generationRecoveryBudgetMs(1_000L, 3_001_000L))
        assertEquals(540_000L, generationRecoveryBudgetMs(1_000L, 0L))
    }
    @Test fun cancellationNeverStartsAnotherPostOrPoll() {
        var cancelled = false; var clock = 0L
        try {
            awaitRecoverableGeneration<String>(submit = { GenerationReply(GenerationReplyKind.Pending) },
                poll = { error("Cancelled poll must not run") }, interrupted = { cancelled },
                now = { clock }, sleep = { clock += it; cancelled = true })
            fail("Must interrupt")
        } catch (_: InterruptedException) { assertTrue(cancelled) }
    }
}
