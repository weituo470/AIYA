package cc.shenliu.aiya.v3

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

internal fun generationStageLabel(stage: String): String = when (stage) {
    "received", "planning" -> "服务器已接收，正在规划作品。"
    "validator-readiness" -> "正在确认验证环境。"
    "web-research", "web_searching", "web_search_completed" -> "正在查询需求所需资料。"
    "generating", "hermes", "model_generating", "model_attempt_started", "calling_model" -> "模型正在生成代码。"
    "switching_model" -> "当前模型调用失败，服务器正在尝试备用配置。"
    "model_succeeded" -> "模型已返回代码，等待服务器验证。"
    "static-check" -> "正在检查结构、语法和资源安全。"
    "runtime-validation", "browser_validation", "browser_revalidation" -> "正在浏览器中验证作品。"
    "repairing", "repairing_once" -> "验证发现问题，正在进行一次定向修复。"
    "completed" -> "作品已完成。"
    else -> "服务器正在处理原任务，等待实际结果。"
}

internal fun parseGenerationReply(status: Int, text: String, polling: Boolean): GenerationReply<JSONObject> {
    val json = runCatching { JSONObject(text) }.getOrNull()
    val build = json?.optJSONObject("build")?.toString().orEmpty()
    val stage = json?.optString("stage").orEmpty()
    val progress = GenerationProgress(generationStageLabel(stage), build)
    if (polling && status == 404) return GenerationReply(GenerationReplyKind.NotAccepted,
        progress = GenerationProgress("等待服务器登记原任务；不会重复提交。", build))
    if (status == 202 || json?.optBoolean("pending", false) == true)
        return GenerationReply(GenerationReplyKind.Pending, progress = progress)
    if (status in 200..299 && json?.optBoolean("ok", false) == true &&
        json.optJSONObject("result")?.optString("html")?.isNotBlank() == true)
        return GenerationReply(GenerationReplyKind.Complete, json, GenerationProgress("作品已完成。", build))
    // An audited model/validation failure is terminal. A proxy error without JSON
    // is transport uncertainty and must query the original task instead.
    if (json?.optBoolean("ok", true) == false || status in listOf(400, 401, 403, 409, 410, 422)) {
        val id = json?.optString("diagnosticId").orEmpty()
        val error = json?.optString("error")?.ifBlank { null } ?: "服务器拒绝了本次任务（HTTP $status）。"
        return GenerationReply(GenerationReplyKind.Failed, progress = GenerationProgress(
            error.take(220) + if (id.isNotBlank()) "（诊断ID：$id）" else "", build))
    }
    return GenerationReply(GenerationReplyKind.Transient, progress = GenerationProgress(
        "暂未取得有效响应，正在查询原任务；不会重复生成。", build))
}

internal fun exchangeGenerationHttp(
    url: String,
    payload: String? = null,
    remainingMs: Long = 540_000L,
): GenerationReply<JSONObject> {
    val polling = payload == null
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = if (polling) "GET" else "POST"
        connectTimeout = minOf(10_000L, maxOf(1L, remainingMs / 2)).toInt()
        readTimeout = minOf(if (polling) 10_000L else 30_000L, maxOf(1L, remainingMs / 2)).toInt()
        setRequestProperty("Accept", "application/json")
        setRequestProperty("Cache-Control", "no-store")
        if (!polling) {
            doOutput = true
            setFixedLengthStreamingMode(payload!!.toByteArray(Charsets.UTF_8).size)
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
        }
    }
    try {
        if (Thread.currentThread().isInterrupted) throw InterruptedException("已撤销生成。")
        payload?.let { data -> connection.outputStream.use { it.write(data.toByteArray(Charsets.UTF_8)) } }
        val status = connection.responseCode
        val text = (if (status in 200..299) connection.inputStream else connection.errorStream)
            ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        return parseGenerationReply(status, text, polling)
    } finally { connection.disconnect() }
}
