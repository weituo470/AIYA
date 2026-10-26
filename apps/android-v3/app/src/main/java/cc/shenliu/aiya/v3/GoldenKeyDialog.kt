package cc.shenliu.aiya.v3

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

internal fun parseGoldenKeyCatalog(raw: String): List<PromptExample> {
    val root = JSONObject(raw)
    require(root.getInt("schemaVersion") == 1)
    val examples = root.getJSONArray("examples")
    val result = (0 until examples.length()).map { i ->
        val e = examples.getJSONObject(i)
        val checks = e.getJSONArray("checks")
        PromptExample(e.getString("id"), e.getString("title"), e.getString("category"),
            e.getString("summary"), e.getString("prompt"), e.getString("requirements"),
            (0 until checks.length()).map { checks.getString(it) }, e.getString("nextStep"))
    }
    require(result.isNotEmpty() && result.map { it.id }.distinct().size == result.size)
    require(result.all { it.prompt.isNotBlank() && it.title.length <= 5 && it.checks.size >= 3 })
    return result
}

@Composable
internal fun GoldenKeyDialog(starterExamples: List<PromptExample>, hasCurrentWork: Boolean,
    onChoose: (PromptExample) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val catalog = remember(context) { runCatching {
        parseGoldenKeyCatalog(context.assets.open("golden-key.json").bufferedReader().use { it.readText() })
    } }
    var starter by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<PromptExample?>(null) }
    val examples = if (starter) starterExamples else catalog.getOrDefault(emptyList())
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(selected?.title ?: "金钥匙", fontSize = 22.sp, fontWeight = FontWeight.Bold) },
        text = { Column(Modifier.fillMaxWidth().heightIn(max = 520.dp)) {
            if (selected == null) {
                Row(Modifier.fillMaxWidth()) {
                    TextButton(onClick = { starter = false }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                        Text("金钥匙", fontSize = 16.sp, fontWeight = if (!starter) FontWeight.Bold else FontWeight.Normal)
                    }
                    TextButton(onClick = { starter = true }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                        Text("入门示例", fontSize = 16.sp, fontWeight = if (starter) FontWeight.Bold else FontWeight.Normal)
                    }
                }
                Text(if (hasCurrentWork) "选用后填入新作品需求，原项目保留；不会自动提交。"
                    else "先看提示词与验收步骤，选用后可改成你的想法。",
                    fontSize = 18.sp, lineHeight = 30.sp)
                Spacer(Modifier.height(12.dp))
                if (!starter && catalog.isFailure) Text("金钥匙内容读取失败，请重新打开或选择入门示例。", fontSize = 18.sp, lineHeight = 30.sp)
                LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(examples, key = { it.id }) { example ->
                        Surface(onClick = { selected = example }, color = Color(0xFFEFFAF5),
                            shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)) {
                            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                                Text(example.title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color(0xFF102E25))
                                Text(example.category, fontSize = 14.sp, color = Color(0xFF126B52))
                                Spacer(Modifier.height(6.dp))
                                Text(example.summary, fontSize = 18.sp, lineHeight = 30.sp, color = Color(0xFF3B594D))
                            }
                        }
                    }
                }
            } else {
                val example = selected!!
                TextButton(onClick = { selected = null }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("返回样板列表", fontSize = 16.sp)
                }
                Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                    if (example.requirements.isNotBlank()) {
                        Text("使用条件", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        Text(example.requirements, fontSize = 18.sp, lineHeight = 30.sp)
                        Spacer(Modifier.height(16.dp))
                    }
                    Text("完整提示词", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Text(example.prompt, fontSize = 18.sp, lineHeight = 32.sp)
                    if (example.checks.isNotEmpty()) {
                        Spacer(Modifier.height(16.dp))
                        Text("生成后，亲手验收", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        example.checks.forEach { Text("• $it", fontSize = 18.sp, lineHeight = 32.sp) }
                        Text("自动检查不替代玩法与手机设备验收。", fontSize = 18.sp, lineHeight = 30.sp, color = Color(0xFF7B4A18))
                    }
                    if (example.nextStep.isNotBlank()) {
                        Spacer(Modifier.height(16.dp))
                        Text("下一步怎么改", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        Text(example.nextStep, fontSize = 18.sp, lineHeight = 30.sp)
                    }
                }
            }
        } },
        confirmButton = {
            selected?.let { example ->
                Button(onClick = { onChoose(example) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("选用提示词", fontSize = 16.sp)
                }
            } ?: TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("关闭", fontSize = 16.sp) }
        },
        dismissButton = {
            selected?.let { example ->
                TextButton(onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText(example.title, example.prompt))
                    Toast.makeText(context, "完整提示词已复制", Toast.LENGTH_SHORT).show()
                }, modifier = Modifier.heightIn(min = 48.dp)) { Text("复制", fontSize = 16.sp) }
            }
        },
    )
}
