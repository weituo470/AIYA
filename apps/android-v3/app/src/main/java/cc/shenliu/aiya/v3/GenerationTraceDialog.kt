package cc.shenliu.aiya.v3

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

private fun traceStatus(value: String): String = when (value) {
    "passed", "succeeded" -> "通过"
    "failed" -> "失败"
    "started", "running", "pending" -> "进行中"
    "not-run" -> "未执行"
    "inconclusive" -> "未能确定"
    "skipped" -> "跳过"
    else -> value.ifBlank { "未记录" }
}

internal fun generationTraceLines(raw: String): List<Pair<String, String>> {
    val build = runCatching { JSONObject(raw) }.getOrNull()
        ?: return listOf("暂无轨迹" to "旧作品未记录轨迹，或服务器尚未返回记录。不能据此判断已测试。")
    val lines = mutableListOf<Pair<String, String>>()
    fun add(label: String, value: String) { lines.add(label to value.ifBlank { "未记录" }) }
    fun seconds(ms: Long): String = if (ms >= 0) "${ms / 1000.0} 秒" else "未记录"
    val model = build.optJSONObject("model")
    val selection = build.optJSONObject("selection")
    add("任务编号", build.optString("taskId"))
    add("技术方案", when (build.optString("route")) {
        "direct-http" -> "模型 API 直接生成单文件 HTML / CSS / JavaScript"
        else -> build.optString("route")
    })
    add("生成偏好", when (build.optString("preference")) {
        "auto" -> "智能判断"; "speed" -> "速度优先"; "quality" -> "质量优先"; else -> "旧版本未记录"
    })
    add("实际返回模型", model?.optString("returned").orEmpty().ifBlank { "尚未成功返回" })
    add("当前请求模型", model?.optString("requested").orEmpty())
    add("选择依据", selection?.optString("reason").orEmpty())
    add("总耗时", seconds(build.optLong("totalDurationMs", -1)))
    val calls = build.optJSONArray("calls")
    add("模型调用记录", "${calls?.length() ?: 0} 条（含进行中的记录；不是费用金额）")
    for (index in 0 until (calls?.length() ?: 0)) {
        val c = calls?.optJSONObject(index) ?: continue
        add("第 ${index + 1} 次调用", "${c.optString("model", "未提供")} · ${traceStatus(c.optString("status"))} · ${seconds(c.optLong("durationMs", -1))}")
    }
    val skipped = selection?.optJSONArray("skippedModels")
    for (index in 0 until (skipped?.length() ?: 0)) {
        val c = skipped?.optJSONObject(index) ?: continue
        add("跳过配置", "${c.optString("model")} · ${c.optString("reason")}")
    }
    val repair = build.optJSONObject("repair")
    add("定向修复", if (repair?.optBoolean("attempted", false) == true)
        traceStatus(repair.optString("status")) else "未触发")
    val checks = build.optJSONArray("checks")
    for (index in 0 until (checks?.length() ?: 0)) {
        val c = checks?.optJSONObject(index) ?: continue
        add("检查 · ${c.optString("name")}", "${traceStatus(c.optString("status"))}：${c.optString("detail")}")
    }
    val validations = build.optJSONArray("validations")
    for (index in 0 until (validations?.length() ?: 0)) {
        val c = validations?.optJSONObject(index) ?: continue
        add("浏览器验证 ${index + 1}", "${traceStatus(c.optString("status"))} · 覆盖：${c.optString("coverage")}")
    }
    val stages = build.optJSONArray("stages")
    for (index in 0 until (stages?.length() ?: 0)) {
        val c = stages?.optJSONObject(index) ?: continue
        add("阶段 · ${c.optString("name")}", "${traceStatus(c.optString("status"))} · ${seconds(c.optLong("durationMs", -1))}")
    }
    add("验证边界", "生成完成不等于完整验收。未知类型可能仅做冒烟；语音、摄像头、体感和完整玩法需亲自测试。记录未提供 Android 实机自动验证结果。")
    return lines
}

@Composable
internal fun GenerationTraceDialog(buildJson: String, onDismiss: () -> Unit) {
    val lines = remember(buildJson) { generationTraceLines(buildJson) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("任务轨迹", fontSize = 22.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState())) {
                lines.forEach { (label, value) ->
                    Text(label, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF126B52))
                    Text(value, fontSize = 18.sp, lineHeight = 32.sp, color = Color(0xFF213E34))
                    Spacer(Modifier.height(18.dp))
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) {
            Text("关闭", fontSize = 16.sp)
        } },
    )
}
