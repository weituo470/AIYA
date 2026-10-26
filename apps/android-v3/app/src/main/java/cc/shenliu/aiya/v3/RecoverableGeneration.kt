package cc.shenliu.aiya.v3

import java.io.IOException

internal enum class GenerationReplyKind { Complete, Pending, NotAccepted, Failed, Transient }
internal data class GenerationProgress(val message: String, val buildJson: String = "")
internal data class GenerationReply<T>(
    val kind: GenerationReplyKind,
    val result: T? = null,
    val progress: GenerationProgress = GenerationProgress("等待服务器处理原任务。"),
)
internal open class GenerationTaskFailure(message: String, val buildJson: String = "") : IllegalStateException(message)
/** No terminal server response was received. The original task may have succeeded. */
internal class GenerationResultUncertain(message: String, buildJson: String = "") : GenerationTaskFailure(message, buildJson)

// Version 0.6.66 cleared the request on timeout, but retained its task ID in the
// failed snapshot. Migrate that exact state; never retry audited model failures.
internal fun generationNeedsRecovery(status: String, message: String): Boolean =
    status == "running" || status == "awaiting-result" ||
        (status == "failed" && message.startsWith("原任务等待已达9分钟上限"))

/** Keep the original wait budget across restarts; allow a short final retrieval
 * after its deadline, not another nine-minute invisible wait. */
internal fun generationRecoveryBudgetMs(startedAtMs: Long, wallNowMs: Long = System.currentTimeMillis()): Long {
    val elapsed = (wallNowMs - startedAtMs).coerceIn(0L, 540_000L)
    return maxOf(30_000L, 540_000L - elapsed)
}

/** One POST only. All reconnects query the same task. The clock is monotonic. */
internal fun <T> awaitRecoverableGeneration(
    submit: () -> GenerationReply<T>,
    poll: (remainingMs: Long) -> GenerationReply<T>,
    onProgress: (GenerationProgress) -> Unit = {},
    timeoutMs: Long = 540_000L,
    now: () -> Long = { System.nanoTime() / 1_000_000L },
    sleep: (Long) -> Unit = { Thread.sleep(it) },
    interrupted: () -> Boolean = { Thread.currentThread().isInterrupted },
    resumeOnly: Boolean = false,
    initialProgress: GenerationProgress = GenerationProgress("正在提交需求。"),
): T {
    require(timeoutMs > 0)
    val deadline = now() + timeoutMs
    var latest = initialProgress
    fun unavailable(): Nothing = throw GenerationResultUncertain(
        "暂未取回原任务结果，尚不能判断生成失败。请恢复原任务，不会重新生成。\n最近状态：${latest.message.take(180)}",
        latest.buildJson,
    )
    fun checkCancelled() { if (interrupted()) throw InterruptedException("本次生成已撤销。") }
    fun transport(action: () -> GenerationReply<T>): GenerationReply<T> {
        checkCancelled()
        return try { action() } catch (error: IOException) {
            checkCancelled()
            GenerationReply(GenerationReplyKind.Transient,
                progress = GenerationProgress("连接中断（${error.message.orEmpty().take(100)}），正在查询原任务；不会重复生成。", latest.buildJson))
        }
    }
    // Recovery after timeout, Activity recreation or process death is GET-only.
    var reply = if (resumeOnly) transport { poll(timeoutMs) } else transport(submit)
    while (true) {
        checkCancelled()
        if (reply.progress.buildJson.isNotBlank()) latest = reply.progress
        else latest = reply.progress.copy(buildJson = latest.buildJson)
        onProgress(latest)
        when (reply.kind) {
            GenerationReplyKind.Complete -> return reply.result
                ?: throw GenerationTaskFailure("服务器没有返回可试玩作品。", latest.buildJson)
            GenerationReplyKind.Failed -> throw GenerationTaskFailure(latest.message, latest.buildJson)
            else -> Unit
        }
        val remaining = deadline - now()
        if (remaining <= 0) unavailable()
        sleep(minOf(2_000L, remaining))
        checkCancelled()
        val pollRemaining = deadline - now()
        if (pollRemaining <= 0) unavailable()
        reply = transport { poll(pollRemaining) }
    }
}
