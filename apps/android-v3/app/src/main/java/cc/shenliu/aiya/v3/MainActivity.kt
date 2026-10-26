package cc.shenliu.aiya.v3

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.Intent
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.net.URLEncoder
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.delay
import kotlin.math.hypot
import kotlin.math.max

private const val PREFS_NAME = "aiya_v3_prefs"
private const val PREF_LATEST_WORK = "latest_work_json"
private const val PREF_WORK_LIBRARY = "work_library_json"
private const val PREF_ACTIVE_WORK_ID = "active_work_id"
private const val PREF_AUDIT_DEVICE_ID = "audit_device_id"
private const val PREF_MODEL_MODE = "preferred_model_mode"
private const val PREF_DISPLAY_NAME = "display_name"
private const val PREF_PREVIOUS_VERSION_PREFIX = "previous_work_version_"
private const val PREF_LAST_COMPLETED_GENERATION_ID = "last_completed_generation_id"
private const val BACKGROUND_GENERATION_REQUEST_FILE_ID = "aiya_background_generation_request"
private const val BACKGROUND_GENERATION_SNAPSHOT_FILE_ID = "aiya_background_generation_snapshot"
private const val MAX_STORED_WORKS = 24
private const val MAX_HTML_BYTES = 800 * 1024
private const val MIN_HTML_BYTES = 40
private const val RECORD_MIN_INTERVAL_MS = 100L
private const val RECORD_BURST_LIMIT = 8
private const val RECORD_TOKEN_BUCKET_PER_MIN = 240
private const val DELETE_HOLD_MILLIS = 3_000
private const val MODEL_SELECTOR_HOLD_MILLIS = 3_000L
private const val AIYA_ORIGIN = "https://aiya.shenliu.cc"
private const val V3_APP_ID = "cc.shenliu.aiya.v3"
private const val TEACHER_CODER_URL = "https://aiya.shenliu.cc/api/teacher-coder"
private const val ASR_WS_URL = "wss://aiya.shenliu.cc/ws/asr"
// Keep V3 teacher voice aligned with V2 useTeacherVoice.ts:
// default teacher speaker + pre-recorded welcome audio + /api/teacher-tts/stream.
private const val TEACHER_TTS_STREAM_URL = "https://aiya.shenliu.cc/api/teacher-tts/stream"
private const val TEACHER_WELCOME_AUDIO_URL = "https://aiya.shenliu.cc/audio/teacher-welcome.mp3?v=20260705-welcome-fixed"
private const val DEFAULT_TEACHER_VOICE = "zh_female_shuangkuaisisi_uranus_bigtts"
private const val TEACHER_WELCOME_TEXT = "\u4f60\u597d\u5440\uff0c\u8ba9\u6211\u4eec\u4ece\u4e00\u4e2a\u5c0f\u5e94\u7528\u5f00\u59cb\u5b66\u4e60AI\u7f16\u7a0b\u5427"
private const val AIYA_LOG_TAG = "AIYA-V3"
private const val APK_JOB_URL = "https://aiya.shenliu.cc/api/create-theatre/apk-jobs"
private const val UPDATE_URL = "https://aiya.shenliu.cc/api/create-theatre/apk-updates"
private const val INTERACTION_URL = "https://aiya.shenliu.cc/api/create-theatre/interactions"
private const val CLASSROOM_SETTINGS_URL = "https://aiya.shenliu.cc/api/create-theatre/settings"
private const val BACKGROUND_GENERATION_CHANGED_ACTION = "cc.shenliu.aiya.v3.BACKGROUND_GENERATION_CHANGED"
private val AIYA_RUNTIME_SESSION_ID = UUID.randomUUID().toString()

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { AiyaV3App() }
    }

    override fun onStop() {
        super.onStop()
        // Make sure we never hold the microphone across background transitions.
        // The Compose DisposableEffect also handles teardown on dispose, but
        // a system-driven background stop can race with recomposition, so
        // proactively cancel the live ASR session here.
        runCatching { AiyaGlobalTeardown.onAppBackgrounded() }
    }
}

private object AiyaGlobalTeardown {
    @Volatile private var controller: AndroidVoiceInputController? = null

    fun register(controller: AndroidVoiceInputController?) {
        this.controller = controller
    }

    fun onAppBackgrounded() {
        controller?.cancel()
    }
}

private enum class AiyaTab(
    val label: String,
    val iconRes: Int,
) {
    Create("创作", R.drawable.aiya_icon_create),
    Play("试玩", R.drawable.aiya_icon_play),
    Export("带走", R.drawable.aiya_icon_export)
}

private enum class GenerationModelMode(
    val id: String,
    val label: String,
    val modelId: String,
    val description: String,
) {
    Default("default", "DeepSeek V4.1 Flash", "deepseek-flash", "响应更快，适合日常创作和快速尝试。"),
    Quality("quality", "GPT-6 Astra · High", "gpt-6-astra", "高强度推理，适合复杂需求和精细修改；可能等待更久。"),
    Fusion("fusion", "Fusion Max 2.0（实验）", "fusion-max-2.0", "需先在服务端开放。生成和继续修改可能超时；若发生降级，请以任务轨迹中的实际模型为准。");

    companion object {
        // Legacy "fast" preferences and pending requests migrate to DeepSeek.
        fun fromId(id: String?): GenerationModelMode = when (id) {
            "quality" -> Quality
            "fusion" -> Fusion
            else -> Default
        }
    }
}

private enum class BuildPreference(val id: String, val label: String, val description: String) {
    Speed("speed", "速度优先", "优先快速配置，尽快验证想法。"),
    Auto("auto", "智能判断", "按需求选模型，限时降级，并跳过近期连续连接失败的配置。"),
    Quality("quality", "质量优先", "优先质量配置，允许等待更久。");
    companion object { fun fromId(id: String?): BuildPreference = entries.firstOrNull { it.id == id } ?: Auto }
}

private data class TeacherProfile(
    val name: String = "AIYA老师",
    val avatar: String = "师",
)

private data class ClassroomRuntimeSettings(
    val teacherProfile: TeacherProfile = TeacherProfile(),
    val modelMode: GenerationModelMode = GenerationModelMode.Default,
)

internal data class PromptExample(
    val id: String,
    val title: String,
    val category: String,
    val summary: String,
    val prompt: String,
    val requirements: String = "",
    val checks: List<String> = emptyList(),
    val nextStep: String = "",
)

private val promptExamples = listOf(
    PromptExample(
        id = "breathing",
        title = "潮汐呼吸",
        category = "放松训练",
        summary = "呼吸节奏、倒计时、进度与完成反馈",
        prompt = """
            做一个名为「潮汐呼吸」的移动端优先呼吸训练应用，帮助学习压力大的学生在1到5分钟内放松。

            视觉采用温暖象牙白、鼠尾草绿和少量珊瑚橙，留白充足、圆角柔和；背景用纯CSS制作很淡的纸张颗粒和漂浮光斑，不要蓝紫霓虹。中央放置会随吸气、停留、呼气缩放的呼吸圆，圆内显示当前阶段和剩余秒数。

            提供4-4-6、4-7-8两种节奏和1、3、5分钟时长；实现“开始”“暂停”“继续”“重置”。显示已完成轮次、总进度和简短鼓励。暂停时动画和倒计时必须同时停止，结束后显示完成状态。手机竖屏无横向滚动，并支持减少动态效果。
        """.trimIndent(),
    ),
    PromptExample(
        id = "pour-over",
        title = "山野手冲",
        category = "生活计时",
        summary = "分阶段咖啡冲煮计时与水量提示",
        prompt = """
            设计一个名为「山野手冲」的咖啡冲煮计时器，适合手机放在咖啡台上使用。

            整体采用日系编辑排版：燕麦米色背景、深咖啡文字、苔藓绿强调色，使用细线分隔、大号数字和少量手绘圆点；用CSS图形表现咖啡杯和蒸汽，不使用照片。中间是大号环形总计时器，下方按时间轴显示“闷蒸”“第一次注水”“第二次注水”“滴滤完成”。

            提供15g/250ml和20g/320ml两个配方，实现“开始”“暂停”“下一步”“重置”。当前步骤高亮，并显示本步骤建议水量；环形进度随时间变化，结束后显示总用时和品鉴提示。所有按钮必须真实可用。
        """.trimIndent(),
    ),
    PromptExample(
        id = "memory-game",
        title = "星图记忆",
        category = "益智游戏",
        summary = "4×4翻牌配对、计时、步数与难度",
        prompt = """
            做一个名为「星图记忆」的4×4翻牌配对小游戏，面向8—14岁学生。

            视觉像精致的天文馆互动展：深海军蓝背景、暖金星光、半透明深色面板，文字对比清楚，不堆满发光特效。16张卡片使用8组星座符号，卡背采用统一星轨纹样。

            点击两张牌后判断配对；错误时短暂停留再翻回，正确时保留并出现轻微庆祝动画。顶部显示“用时”“步数”“已配对”，提供“开始游戏”“重新开始”和简单、普通两种难度，难度影响预览时间。全部配对后显示成绩和评级。支持鼠标和触摸，手机上卡片不能溢出。
        """.trimIndent(),
    ),
    PromptExample(
        id = "mood-dashboard",
        title = "今日能量",
        category = "情绪记录",
        summary = "心情签到、能量滑杆、建议与趋势",
        prompt = """
            创建一个名为「今日能量」的轻量情绪签到应用，只记录本次页面会话，不需要账号或长期保存。

            视觉采用现代健康杂志风：奶油白底、墨绿色正文、番茄红点缀，大标题、非对称留白和细腻阴影，避免常见蓝紫渐变。首屏包含一句问候、5个心情选项、1—10能量滑杆和备注输入框。

            点击“完成签到”后生成今日摘要，显示心情、能量值、当前时间，以及根据能量高低给出的3条建议。下方显示最近5次本次会话签到的迷你趋势图，并提供“清空本次记录”。选中、提交成功、空内容和清空操作都要有明确反馈；移动端单列、桌面端双栏。
        """.trimIndent(),
    ),
    PromptExample(
        id = "cognition-compass",
        title = "认知罗盘",
        category = "互动测评",
        summary = "逐题选择、信心程度与四维报告",
        prompt = """
            制作一个名为「认知罗盘」的8题思考方式测评应用，核心流程是“逐题选择→确认信心程度→查看维度报告”。

            采用理性编辑设计：纸张灰背景、墨黑文字、酸性荧光绿作为唯一强调色；小圆角、细边框、几乎不用阴影，像严谨的研究手册。桌面端使用窄侧栏显示题目进度，手机端改成顶部进度条，每次只展示一道题。

            预置8道中文情境题，每题4个选项和1—5信心滑杆。支持“上一题”“下一题”、未作答提醒和回退保持答案。结果页展示“证据意识、系统思考、行动倾向、开放程度”四个维度以及建议。相同答案必须得到相同结果，并提供“重新测评”。
        """.trimIndent(),
    ),
    PromptExample(
        id = "drawing-studio",
        title = "彩虹小画室",
        category = "创意工具",
        summary = "触屏绘画、撤销、橡皮与图片下载",
        prompt = """
            制作一个名为「彩虹小画室」的触屏绘画应用，面向儿童和亲子使用。

            视觉柔和但不幼稚：云朵白、天空蓝、珊瑚红和明黄色；工具栏像排列整齐的文具盒，避免卡通图片和Emoji堆砌。顶部显示标题和操作提示，中间是尽可能大的自适应Canvas画布，底部固定工具栏。

            同时支持鼠标和手指绘画，提供6种颜色、画笔粗细滑杆，以及“画笔”“橡皮”“撤销”“清空”“下载图片”。撤销最多保留20步，清空前需要确认，下载生成本地PNG。触屏绘画时页面不能跟随滚动，所有工具必须有明显选中状态。
        """.trimIndent(),
    ),
    PromptExample(
        id = "envelope-budget",
        title = "零钱信封",
        category = "预算工具",
        summary = "预算、支出、分类占比与超支提示",
        prompt = """
            制作一个名为「零钱信封」的个人月度预算应用，核心闭环是“设置预算→记录支出→查看剩余金额和分类占比”。

            采用温暖账本风：燕麦色背景、炭黑文字、森林绿和橙红点缀，使用票据式虚线、细边框和克制阴影，金额使用等宽感排版。顶部显示本月预算、已支出和剩余金额；中部用CSS圆环显示分类占比；下方为支出列表和新增区域。

            预置5800元预算及6条餐饮、交通、购物支出。支持新增、删除、分类筛选和“恢复示例数据”。金额非法时显示提示，所有金额保留两位小数；超预算时使用明显但不刺眼的警示状态。数据只保留当前页面。
        """.trimIndent(),
    ),
    PromptExample(
        id = "packing-list",
        title = "行李减法",
        category = "旅行清单",
        summary = "分类清单、打包进度与未装筛选",
        prompt = """
            制作一个名为「行李减法」的移动端旅行打包清单，核心流程是“查看分类→勾选物品→确认打包完成”。

            采用旅行编辑风：浅沙色背景、远山蓝和日落橙点缀，大面积留白、细边框和行李标签式标题，装饰只使用CSS几何图形。顶部显示“大理·4天3夜”、出发倒计时和总进度环；中部按证件、衣物、洗护、电子用品分类。

            预置18项物品，支持勾选、取消、添加、删除、折叠分类和“只看未装”。每个分类及总进度实时更新，全部完成后显示“可以出发了”。删除需要二次确认，空名称有提示，手机上适合单手操作。
        """.trimIndent(),
    ),
    PromptExample(
        id = "plant-care",
        title = "绿友浇水",
        category = "植物养护",
        summary = "今日待办、浇水周期与未来时间线",
        prompt = """
            制作一个名为「绿友浇水」的室内植物养护应用，核心闭环是“查看今日待办→标记已浇水→计算下次日期”。

            视觉采用植物实验室风：鼠尾草绿、奶油白、陶土橙和深绿色；使用CSS叶片轮廓、细线刻度和标本标签，不使用照片。顶部突出今日待办数量，中部切换不同植物，下方展示浇水周期、光照建议和未来7日时间线。

            预置绿萝、龟背竹、虎皮兰、薄荷和多肉。支持“标记已浇水”“撤销浇水”“只看今日待办”和“恢复示例数据”。操作后立即更新最近日期和下次浇水日期；没有待办时显示安静的完成状态，日期不能出现负数。
        """.trimIndent(),
    ),
    PromptExample(
        id = "beat-workshop",
        title = "口袋节拍",
        category = "音乐实验",
        summary = "4轨8步节奏编辑与原生合成音色",
        prompt = """
            制作一个名为「口袋节拍工坊」的4轨8步节奏编辑器，面向音乐初学者。

            采用克制的暗色合成器风格：黑蓝背景、面板灰、薄荷绿和橙色点缀，使用清晰网格、机械刻度和轻微发光，不使用外部图标或音频文件。中央显示4行8列节拍网格，轨道名称为“底鼓、拍手、沙锤、木鱼”。

            点击格子切换节拍状态，使用浏览器原生Web Audio合成短音色。实现“播放”“停止”“清空”“示例节奏”“声音”，速度范围60—160 BPM，播放游标逐格移动。音频必须由用户点击后启动，停止后再次播放不能叠加多个循环；手机端每个节拍格至少44px。
        """.trimIndent(),
    ),
)

private fun isExplicitNewWorkRequest(idea: String): Boolean {
    val text = idea.trim().replace(Regex("\\s+"), "")
    if (text.isBlank()) return false
    val negativeHints = listOf("不要新建", "不用新建", "别新建", "不是新建", "不要重新", "不用重新", "别重新")
    if (negativeHints.any { text.contains(it) }) return false
    val freshHints = listOf(
        "新建",
        "新做",
        "新生成",
        "新应用",
        "新项目",
        "新作品",
        "创建一个",
        "创建个",
        "创建新的",
        "做一个新的",
        "做个新的",
        "重新做",
        "重做一个",
        "重做个",
        "从头做",
        "另做一个",
        "另做个",
        "再做一个",
        "再做个",
        "换一个作品",
    )
    return freshHints.any { text.contains(it) }
}

private fun shouldStartFreshWork(idea: String, currentWork: GeneratedWork?): Boolean {
    if (currentWork == null) return true
    return isExplicitNewWorkRequest(idea)
}

private fun estimateCodingTimeLabel(
    idea: String,
    currentWork: GeneratedWork?,
    modelMode: GenerationModelMode,
): String {
    val normalized = idea.trim().lowercase()
    var seconds = 50
    seconds += when {
        normalized.length >= 600 -> 30
        normalized.length >= 240 -> 20
        normalized.length >= 80 -> 10
        else -> 0
    }
    if (Regex("语音|播报|音效|tts|speech|voice").containsMatchIn(normalized)) seconds += 15
    if (Regex("游戏|塔防|赛车|飞机|粒子|canvas|game").containsMatchIn(normalized)) seconds += 20
    if (Regex("拖拽|物理|寻路|多人|关卡|波次|动画").containsMatchIn(normalized)) seconds += 15
    val featureHits = listOf(
        "支持", "增加", "实现", "要求", "功能", "适配", "优化", "预留",
    ).sumOf { term -> Regex.escape(term).toRegex().findAll(normalized).count() }
    if (featureHits >= 5) seconds += 15
    if (featureHits >= 10) seconds += 15
    if (currentWork != null) seconds += 10
    seconds += when (modelMode) {
        GenerationModelMode.Quality -> 20
        GenerationModelMode.Fusion -> 20
        GenerationModelMode.Default -> 0
    }
    return when {
        seconds <= 70 -> "1到2分钟"
        seconds <= 120 -> "2到3分钟"
        seconds <= 170 -> "3到4分钟"
        else -> "4到6分钟"
    }
}

private fun normalizeTeacherProfile(profile: TeacherProfile): TeacherProfile {
    val name = profile.name.trim().ifBlank { "AIYA老师" }.take(12)
    val avatar = profile.avatar.trim().ifBlank { "师" }.take(4)
    return TeacherProfile(name = name, avatar = avatar)
}

private data class GeneratedWork(
    val id: String = "",
    val title: String,
    val brief: String,
    val html: String,
    val reply: String,
    val model: String,
    val buildExecutionJson: String = "",
    val sourceIdea: String = "",
    val createdAt: Long = 0L,
    val updatedAt: Long = 0L,
)

/* The request is persisted before the foreground service begins. This lets a
 * returning Activity reconnect to the same task instead of losing it with the
 * Compose screen instance. */
private data class BackgroundGenerationRequest(
    val generationId: String,
    val idea: String,
    val previousWorkId: String?,
    val modelModeId: String,
    val buildPreferenceId: String = "auto",
    val manualModel: Boolean = true,
)

private data class BackgroundGenerationSnapshot(
    val generationId: String,
    val idea: String,
    val status: String,
    val message: String = "",
    val completedAt: Long = 0L,
    val startedAt: Long = System.currentTimeMillis(),
    val buildExecutionJson: String = "",
)

class GenerationForegroundService : Service() {
    private var worker: Thread? = null
    @Volatile private var cancelled = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android requires this call very shortly after startForegroundService().
        // Do it before encrypted state I/O so a corrupted/stale task file can never
        // turn into ForegroundServiceDidNotStartInTimeException and crash the app.
        if (intent?.action == ACTION_START || intent?.action == ACTION_RECOVER) {
            try {
                showForegroundNotification("")
            } catch (error: Throwable) {
                Log.e(AIYA_LOG_TAG, "foreground generation notification could not start", error)
                stopSelf(startId)
                return START_NOT_STICKY
            }
        }
        try {
        if (intent?.action == ACTION_CANCEL) {
            cancelled = true
            val generationId = intent.getStringExtra(EXTRA_GENERATION_ID).orEmpty()
            if (generationId.isNotBlank()) {
                writeBackgroundGenerationSnapshot(
                    applicationContext,
                    BackgroundGenerationSnapshot(
                        generationId = generationId,
                        idea = readBackgroundGenerationSnapshot(applicationContext)?.idea.orEmpty(),
                        status = STATUS_CANCELLED,
                        message = "\u5df2\u53d6\u6d88\u672c\u6b21\u751f\u6210\u3002",
                        completedAt = System.currentTimeMillis(),
                    ),
                )
                notifyGenerationChanged(applicationContext, generationId)
            }
            worker?.interrupt()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val generationId = intent?.getStringExtra(EXTRA_GENERATION_ID).orEmpty()
        if (worker?.isAlive == true) return START_NOT_STICKY
        val recoveryOnly = intent?.action == ACTION_RECOVER
        val previousSnapshot = readBackgroundGenerationSnapshot(applicationContext)
            ?.takeIf { it.generationId == generationId }
        val request = readBackgroundGenerationRequest(applicationContext)
            ?.takeIf { it.generationId == generationId }
            ?: if (recoveryOnly && previousSnapshot != null &&
                generationNeedsRecovery(previousSnapshot.status, previousSnapshot.message)) {
                // Legacy timeout snapshots still have the identity of the original
                // task. Save recovered work as a separate project, not over an
                // unrelated active project, when old request metadata is missing.
                BackgroundGenerationRequest(generationId, previousSnapshot.idea, null, GenerationModelMode.Default.id)
            } else null
        if (generationId.isBlank() || request?.generationId != generationId) {
            if (generationId.isNotBlank()) {
                runCatching {
                    clearBackgroundGenerationRequest(applicationContext)
                    writeBackgroundGenerationSnapshot(
                        applicationContext,
                        BackgroundGenerationSnapshot(
                            generationId = generationId,
                            idea = "",
                            status = STATUS_FAILED,
                            message = "\u540e\u53f0\u4efb\u52a1\u72b6\u6001\u65e0\u6cd5\u8bfb\u53d6\uff0c\u8bf7\u91cd\u65b0\u63d0\u4ea4\u3002",
                            completedAt = System.currentTimeMillis(),
                        ),
                    )
                    notifyGenerationChanged(applicationContext, generationId)
                }
            }
            runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
            stopSelf(startId)
            return START_NOT_STICKY
        }
        cancelled = false
        if (recoveryOnly) writeBackgroundGenerationRequest(applicationContext, request)
        showForegroundNotification(request.idea)
        writeBackgroundGenerationSnapshot(
            applicationContext,
            BackgroundGenerationSnapshot(
                generationId = request.generationId,
                idea = request.idea,
                status = STATUS_RUNNING,
                message = if (recoveryOnly) "正在取回原任务结果，不会重新生成。" else "\u6b63\u5728\u540e\u53f0\u751f\u6210\u4f5c\u54c1\u3002",
                startedAt = previousSnapshot?.startedAt ?: System.currentTimeMillis(),
                buildExecutionJson = previousSnapshot?.buildExecutionJson.orEmpty(),
            ),
        )
        notifyGenerationChanged(applicationContext, request.generationId)

        worker = Thread {
            val context = applicationContext
            try {
                val library = readWorkLibrary(context)
                val previousWork = request.previousWorkId?.let { id -> library.firstOrNull { it.id == id } }
                val generated = requestTeacherCoder(
                    context = context,
                    clientTaskId = request.generationId,
                    idea = request.idea,
                    currentWork = previousWork,
                    modelMode = GenerationModelMode.fromId(request.modelModeId),
                    buildPreference = BuildPreference.fromId(request.buildPreferenceId),
                    manualModel = request.manualModel,
                    recoveryOnly = recoveryOnly,
                    generationBudgetMs = if (recoveryOnly) generationRecoveryBudgetMs(previousSnapshot?.startedAt ?: System.currentTimeMillis()) else 540_000L,
                    initialBuildJson = previousSnapshot?.buildExecutionJson.orEmpty(),
                    onProgress = { progress ->
                        if (!cancelled) {
                            val previous = readBackgroundGenerationSnapshot(context)
                            if (previous?.generationId == request.generationId &&
                                (previous.message != progress.message || previous.buildExecutionJson != progress.buildJson)) {
                                writeBackgroundGenerationSnapshot(context, previous.copy(message = progress.message, buildExecutionJson = progress.buildJson))
                                notifyGenerationChanged(context, request.generationId)
                            }
                        }
                    },
                )
                if (cancelled || readBackgroundGenerationSnapshot(context)?.generationId != request.generationId) return@Thread
                saveWorkToLibrary(
                    context = context,
                    generatedWork = generated,
                    previousWork = previousWork,
                    sourceIdea = request.idea,
                    currentLibrary = readWorkLibrary(context),
                )
                writeBackgroundGenerationSnapshot(
                    context,
                    BackgroundGenerationSnapshot(
                        generationId = request.generationId,
                        idea = request.idea,
                        status = STATUS_SUCCEEDED,
                        message = generated.title.ifBlank { "AIYA \u4f5c\u54c1" },
                        completedAt = System.currentTimeMillis(),
                        startedAt = previousSnapshot?.startedAt ?: System.currentTimeMillis(),
                        buildExecutionJson = generated.buildExecutionJson,
                    ),
                )
                clearBackgroundGenerationRequest(context)
            } catch (error: Throwable) {
                if (!cancelled && readBackgroundGenerationSnapshot(context)?.generationId == request.generationId) {
                    val uncertain = error is GenerationResultUncertain
                    Log.w(AIYA_LOG_TAG, "generation id=${request.generationId} uncertain=$uncertain: ${error.message}")
                    writeBackgroundGenerationSnapshot(
                        context,
                        BackgroundGenerationSnapshot(
                            generationId = request.generationId,
                            idea = request.idea,
                            status = if (uncertain) STATUS_AWAITING_RESULT else STATUS_FAILED,
                            message = (error.message ?: "\u751f\u6210\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002").take(220),
                            completedAt = System.currentTimeMillis(),
                            buildExecutionJson = (error as? GenerationTaskFailure)?.buildJson.orEmpty(),
                            startedAt = previousSnapshot?.startedAt ?: System.currentTimeMillis(),
                        ),
                    )
                    // Preserve project/task metadata for a future GET-only recovery.
                    if (!uncertain) clearBackgroundGenerationRequest(context)
                }
            } finally {
                notifyGenerationChanged(context, request.generationId)
                stopForeground(STOP_FOREGROUND_REMOVE)
                // ON_RESUME may have sent another RECOVER intent to this same
                // live worker. Stop the service even if its startId advanced.
                stopSelf()
            }
        }.apply {
            name = "aiya-v3-background-generation"
            isDaemon = false
            start()
        }
        return START_NOT_STICKY
        } catch (error: Throwable) {
            val generationId = intent?.getStringExtra(EXTRA_GENERATION_ID).orEmpty()
            Log.e(AIYA_LOG_TAG, "background generation service could not start", error)
            runCatching {
                if (generationId.isNotBlank()) {
                    writeBackgroundGenerationSnapshot(
                        applicationContext,
                        BackgroundGenerationSnapshot(
                            generationId = generationId,
                            idea = readBackgroundGenerationSnapshot(applicationContext)?.idea.orEmpty(),
                            status = STATUS_FAILED,
                            message = (error.message ?: "\u65e0\u6cd5\u542f\u52a8\u540e\u53f0\u751f\u6210\u3002").take(220),
                            completedAt = System.currentTimeMillis(),
                        ),
                    )
                    notifyGenerationChanged(applicationContext, generationId)
                }
            }
            runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
            stopSelf(startId)
            return START_NOT_STICKY
        }
    }

    override fun onDestroy() {
        cancelled = true
        worker?.interrupt()
        super.onDestroy()
    }

    private fun showForegroundNotification(idea: String) {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "AIYA \u4f5c\u54c1\u751f\u6210",
            NotificationManager.IMPORTANCE_LOW,
        )
        manager.createNotificationChannel(channel)
        val notification: Notification = Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("AIYA \u6b63\u5728\u521b\u4f5c")
            .setContentText(idea.take(60).ifBlank { "\u6b63\u5728\u751f\u6210\u4f5c\u54c1" })
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        const val ACTION_START = "cc.shenliu.aiya.v3.action.START_GENERATION"
        const val ACTION_RECOVER = "cc.shenliu.aiya.v3.action.RECOVER_GENERATION"
        const val ACTION_CANCEL = "cc.shenliu.aiya.v3.action.CANCEL_GENERATION"
        const val EXTRA_GENERATION_ID = "generationId"
        private const val NOTIFICATION_CHANNEL_ID = "aiya_generation"
        private const val NOTIFICATION_ID = 7301
        const val STATUS_RUNNING = "running"
        const val STATUS_SUCCEEDED = "succeeded"
        const val STATUS_FAILED = "failed"
        const val STATUS_AWAITING_RESULT = "awaiting-result"
        const val STATUS_CANCELLED = "cancelled"
    }
}

private data class SavedWorkLibraryResult(
    val activeWork: GeneratedWork,
    val library: List<GeneratedWork>,
)

private data class DeleteWorkLibraryResult(
    val activeWork: GeneratedWork?,
    val library: List<GeneratedWork>,
)

private sealed interface GenerationState {
    data object Idle : GenerationState
    data class Loading(val idea: String, val generationId: String, val message: String = "正在提交需求。",
        val startedAt: Long = System.currentTimeMillis(), val buildExecutionJson: String = "") : GenerationState
    data class Failed(val message: String, val lastIdea: String, val buildExecutionJson: String = "",
        val recoveryTaskId: String = "") : GenerationState
    data object Ready : GenerationState
}

private fun BackgroundGenerationSnapshot.asFailureState(): GenerationState.Failed {
    val recoverable = generationNeedsRecovery(status, message)
    return GenerationState.Failed(
        message = if (recoverable && status == GenerationForegroundService.STATUS_FAILED)
            "原任务结果尚未取回，不代表生成失败。可恢复原任务，不会重新调用模型。"
        else message.ifBlank { "生成失败，请查看任务轨迹。" },
        lastIdea = idea,
        buildExecutionJson = buildExecutionJson,
        recoveryTaskId = if (recoverable) generationId else "",
    )
}

private sealed interface ExportState {
    data object Idle : ExportState
    data class Working(val message: String) : ExportState
    data class Done(val message: String) : ExportState
    data class Failed(val message: String) : ExportState
}

private data class ExportTaskResult(
    val message: String,
    val installFile: File? = null,
    val shareFile: File? = null,
)

private data class AppUpdateManifest(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val filename: String,
    val message: String,
    val apkSha256: String,
    val apkBytes: Long,
)

private sealed interface AppUpdateState {
    data object Idle : AppUpdateState
    data object Checking : AppUpdateState
    data class Current(val versionName: String) : AppUpdateState
    data class Available(val manifest: AppUpdateManifest) : AppUpdateState
    data class Downloading(val versionName: String) : AppUpdateState
    data class Downloaded(val message: String) : AppUpdateState
    data class Failed(val message: String, val manifest: AppUpdateManifest? = null) : AppUpdateState
}

private data class ShowcaseIcon(
    val symbol: String = "utility",
    val palette: String = "mint",
)

private data class ShowcaseWork(
    val id: String,
    val title: String,
    val brief: String,
    val author: String,
    val model: String,
    val initialPrompt: String,
    val html: String,
    val featuredAt: String,
    val icon: ShowcaseIcon? = null,
)

private sealed interface ShowcaseState {
    data object Idle : ShowcaseState
    data object Loading : ShowcaseState
    data class Ready(val works: List<ShowcaseWork>) : ShowcaseState
    data class Failed(val message: String) : ShowcaseState
}


private sealed interface VoiceStatus {
    data object Idle : VoiceStatus
    data object PermissionReady : VoiceStatus
    data object Connecting : VoiceStatus
    data object Listening : VoiceStatus
    data object Transcribing : VoiceStatus
    data object Done : VoiceStatus
    data class Error(val message: String) : VoiceStatus
}

private data class VoiceUiState(
    val status: VoiceStatus = VoiceStatus.Idle,
    val liveText: String = "",
) {
    val isActive: Boolean
        get() = status is VoiceStatus.Connecting || status is VoiceStatus.Listening || status is VoiceStatus.Transcribing

    val label: String
        get() = when (status) {
            VoiceStatus.Idle -> "按住说话"
            VoiceStatus.PermissionReady -> "可以说了"
            VoiceStatus.Connecting -> "正在连接"
            VoiceStatus.Listening -> "正在听"
            VoiceStatus.Transcribing -> "正在识别"
            VoiceStatus.Done -> "已提交"
            is VoiceStatus.Error -> "重试语音"
        }

    val message: String
        get() = when (status) {
            VoiceStatus.Idle -> "按住说话，松开后直接提交。"
            VoiceStatus.PermissionReady -> "再按住说话，松开后直接提交。"
            VoiceStatus.Connecting -> "正在连接语音识别服务。"
            VoiceStatus.Listening -> "现在说话，松手后直接提交。"
            VoiceStatus.Transcribing -> liveText.ifBlank { "正在识别最后一句。" }
            VoiceStatus.Done -> "已提交给老师，请稍等。"
            is VoiceStatus.Error -> status.message
        }
}

private sealed interface TeacherVoiceStatus {
    data object Idle : TeacherVoiceStatus
    data object Loading : TeacherVoiceStatus
    data object Speaking : TeacherVoiceStatus
    data class Error(val message: String) : TeacherVoiceStatus
}

private data class TeacherVoiceUiState(
    val status: TeacherVoiceStatus = TeacherVoiceStatus.Idle,
    val message: String = "",
) {
    val isActive: Boolean
        get() = status is TeacherVoiceStatus.Loading || status is TeacherVoiceStatus.Speaking

    val label: String
        get() = when (status) {
            TeacherVoiceStatus.Idle -> "\u8001\u5e08\u8bed\u97f3"
            TeacherVoiceStatus.Loading -> "\u8fde\u63a5\u8001\u5e08\u8bed\u97f3"
            TeacherVoiceStatus.Speaking -> "\u8001\u5e08\u6b63\u5728\u8bf4"
            is TeacherVoiceStatus.Error -> "\u8bed\u97f3\u5931\u8d25"
        }
}
private val AiyaGreen = Color(0xFF00B981)
private val AiyaInk = Color(0xFF071B16)
private val AiyaMist = Color(0xFFF2FFFA)
private val AiyaLine = Color(0xFFD7F2E9)

private val aiyaColorScheme = lightColorScheme(
    primary = AiyaGreen,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD9FFF0),
    onPrimaryContainer = AiyaInk,
    secondary = Color(0xFF12866B),
    background = Color(0xFFF8FCFA),
    surface = Color.White,
    onSurface = AiyaInk,
    outline = AiyaLine,
)

@Composable
private fun AiyaV3App() {
    MaterialTheme(colorScheme = aiyaColorScheme) {
        val context = LocalContext.current
        val appPreferences = remember(context) {
            context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }
        val initialWorkLibrary = remember { readWorkLibrary(context.applicationContext) }
        val initialBackgroundGeneration = remember { readBackgroundGenerationSnapshot(context.applicationContext) }
        var selectedTab by rememberSaveable { mutableStateOf(AiyaTab.Create) }
        var showCreateEntryChoice by remember { mutableStateOf(false) }
        var continueCurrentWorkChosen by rememberSaveable { mutableStateOf(false) }
        var idea by rememberSaveable { mutableStateOf("") }
        var workLibrary by remember { mutableStateOf(initialWorkLibrary) }
        var currentWork by remember {
            mutableStateOf(readActiveWork(context.applicationContext, initialWorkLibrary))
        }
        var generationState by remember {
            mutableStateOf<GenerationState>(
                when (initialBackgroundGeneration?.status) {
                    GenerationForegroundService.STATUS_RUNNING -> GenerationState.Loading(
                        initialBackgroundGeneration.idea,
                        initialBackgroundGeneration.generationId,
                        initialBackgroundGeneration.message,
                        initialBackgroundGeneration.startedAt,
                        initialBackgroundGeneration.buildExecutionJson,
                    )
                    GenerationForegroundService.STATUS_FAILED,
                    GenerationForegroundService.STATUS_AWAITING_RESULT -> initialBackgroundGeneration.asFailureState()
                    else -> if (readActiveWork(context.applicationContext, initialWorkLibrary) != null) {
                        GenerationState.Ready
                    } else {
                        GenerationState.Idle
                    }
                },
            )
        }
        var voiceUiState by remember { mutableStateOf(VoiceUiState()) }
        var teacherVoiceUiState by remember { mutableStateOf(TeacherVoiceUiState()) }
        var teacherProfile by remember { mutableStateOf(TeacherProfile()) }
        var displayName by remember {
            mutableStateOf(appPreferences.getString(PREF_DISPLAY_NAME, "我").orEmpty().trim().ifBlank { "我" })
        }
        var hasLocalModelMode by remember { mutableStateOf(appPreferences.contains(PREF_MODEL_MODE)) }
        var selectedModelMode by remember {
            mutableStateOf(GenerationModelMode.fromId(appPreferences.getString(PREF_MODEL_MODE, null)))
        }
        var modelSelectionRequestId by remember { mutableStateOf(0L) }
        var exportState by remember { mutableStateOf<ExportState>(ExportState.Idle) }
        var sourceViewerWork by remember { mutableStateOf<GeneratedWork?>(null) }
        var showShowcase by remember { mutableStateOf(false) }
        var showcaseState by remember { mutableStateOf<ShowcaseState>(ShowcaseState.Idle) }
        var appUpdateState by remember { mutableStateOf<AppUpdateState>(AppUpdateState.Checking) }
        var pendingVoiceStart by remember { mutableStateOf(false) }
        var welcomeVoiceStarted by rememberSaveable { mutableStateOf(false) }
        var activeGenerationId by remember {
            mutableStateOf(
                initialBackgroundGeneration
                    ?.takeIf { it.status == GenerationForegroundService.STATUS_RUNNING }
                    ?.generationId,
            )
        }
        var autoRecoveryAttemptedTaskId by remember { mutableStateOf("") }
        val mainHandler = remember { Handler(Looper.getMainLooper()) }
        val voiceController = remember(context, mainHandler) {
            AndroidVoiceInputController(context.applicationContext, mainHandler)
        }
        val teacherVoiceController = remember(context, mainHandler) {
            AndroidTeacherVoiceController(context.applicationContext, mainHandler)
        }

        DisposableEffect(voiceController) {
            AiyaGlobalTeardown.register(voiceController)
            onDispose {
                voiceController.cancel()
                AiyaGlobalTeardown.register(null)
            }
        }

        DisposableEffect(teacherVoiceController) {
            onDispose { teacherVoiceController.release() }
        }

        DisposableEffect(Unit) {
            Thread {
                val result = runCatching { checkForAppUpdateWithRetry() }
                mainHandler.post {
                    appUpdateState = result.fold(
                        onSuccess = { manifest ->
                            if (manifest == null) AppUpdateState.Current(BuildConfig.VERSION_NAME)
                            else AppUpdateState.Available(manifest)
                        },
                        // Automatic update checks must never block or alarm the user.
                        // A later manual check remains available by tapping the version number.
                        onFailure = {
                            Log.w(AIYA_LOG_TAG, "automatic update check unavailable", it)
                            AppUpdateState.Idle
                        },
                    )
                }
            }.start()
            onDispose { }
        }

        DisposableEffect(Unit) {
            Thread {
                val result = runCatching { fetchClassroomRuntimeSettings() }
                mainHandler.post {
                    result.onSuccess { settings ->
                        teacherProfile = settings.teacherProfile
                        if (!hasLocalModelMode) selectedModelMode = settings.modelMode
                    }
                }
            }.apply {
                name = "aiya-v3-classroom-settings"
                isDaemon = true
                start()
            }
            onDispose { }
        }

        fun buildVoiceRequestIdea(text: String): String {
            val normalized = text.trim()
            if (normalized.isBlank()) return ""
            return if (idea.isBlank()) {
                normalized
            } else {
                "${idea.trim()}\n$normalized"
            }.take(1_200)
        }

        fun speakTeacher(text: String) {
            val normalized = text.trim()
            if (normalized.isBlank()) return
            teacherVoiceController.speak(
                text = normalized,
                onState = { teacherVoiceUiState = it },
            )
        }

        fun applySelectedModelMode(mode: GenerationModelMode) {
            selectedModelMode = mode
            hasLocalModelMode = true
            appPreferences.edit().putString(PREF_MODEL_MODE, mode.id).apply()
            Toast.makeText(context, "已切换到${mode.label}", Toast.LENGTH_SHORT).show()
            speakTeacher("已经切换到${mode.label}。下一次创作会优先使用这个模型配置。")
        }

        fun selectModelMode(mode: GenerationModelMode) {
            val selectionRequestId = ++modelSelectionRequestId
            if (mode != GenerationModelMode.Fusion) {
                applySelectedModelMode(mode)
                return
            }
            // Metadata-only check: never pay for a model probe just to select it.
            Thread {
                val available = runCatching { isFusionConfiguredOnServer() }
                mainHandler.post {
                    if (selectionRequestId != modelSelectionRequestId) return@post
                    if (available.getOrDefault(false)) {
                        applySelectedModelMode(mode)
                    } else {
                        Toast.makeText(context, if (available.isFailure) "暂时无法确认 Fusion 状态，请检查网络后重试。当前模型未改变。" else "Fusion 服务端尚未开放，当前模型未改变。", Toast.LENGTH_LONG).show()
                    }
                }
            }.apply { name = "aiya-v3-model-availability"; isDaemon = true; start() }
        }

        fun updateDisplayName(value: String) {
            val normalized = value.trim().replace(Regex("\\s+"), " ").take(16).ifBlank { "我" }
            displayName = normalized
            appPreferences.edit().putString(PREF_DISPLAY_NAME, normalized).apply()
            Toast.makeText(context, "已改为“$normalized”", Toast.LENGTH_SHORT).show()
        }

        fun stopTeacherVoice() {
            teacherVoiceController.stop()
            teacherVoiceUiState = TeacherVoiceUiState()
        }

        fun reconcileBackgroundGeneration() {
            val snapshot = readBackgroundGenerationSnapshot(context.applicationContext)
            if (snapshot == null) {
                val loading = generationState as? GenerationState.Loading ?: return
                val pending = readBackgroundGenerationRequest(context.applicationContext)
                if (pending?.generationId == loading.generationId) return

                // The worker has cleared its request, but a missed lifecycle update
                // left Compose on the loading card. Rebuild from durable storage.
                val refreshedLibrary = readWorkLibrary(context.applicationContext)
                val refreshedWork = readActiveWork(context.applicationContext, refreshedLibrary)
                workLibrary = refreshedLibrary
                currentWork = refreshedWork
                activeGenerationId = null
                generationState = if (refreshedWork != null) GenerationState.Ready else {
                    GenerationState.Failed(
                        "\u751f\u6210\u4efb\u52a1\u5df2\u7ed3\u675f\uff0c\u4f46\u6ca1\u6709\u627e\u5230\u53ef\u8bd5\u73a9\u4f5c\u54c1\u3002",
                        loading.idea,
                    )
                }
                selectedTab = AiyaTab.Play
                return
            }
            when (snapshot.status) {
                GenerationForegroundService.STATUS_RUNNING -> {
                    activeGenerationId = snapshot.generationId
                    generationState = GenerationState.Loading(snapshot.idea, snapshot.generationId, snapshot.message, snapshot.startedAt, snapshot.buildExecutionJson)
                }
                GenerationForegroundService.STATUS_SUCCEEDED -> {
                    val refreshedLibrary = readWorkLibrary(context.applicationContext)
                    workLibrary = refreshedLibrary
                    currentWork = readActiveWork(context.applicationContext, refreshedLibrary)
                    activeGenerationId = null
                    generationState = if (currentWork != null) GenerationState.Ready else GenerationState.Idle
                    idea = ""
                    selectedTab = AiyaTab.Play
                    val alreadyAnnounced = appPreferences
                        .getString(PREF_LAST_COMPLETED_GENERATION_ID, "") == snapshot.generationId
                    if (!alreadyAnnounced) currentWork?.let { work ->
                        val appTitle = work.title.trim().ifBlank { "\u8fd9\u4e2a\u5e94\u7528" }
                        val completionSubject = if (appTitle.endsWith("\u5e94\u7528")) appTitle else "${appTitle}\u5e94\u7528"
                        speakTeacher("${completionSubject}\u5df2\u5b8c\u6210\uff0c\u8bf7\u6d4b\u8bd5\u6548\u679c\uff0c\u7136\u540e\u4f60\u53ef\u4ee5\u70b9\u51fb\u5de6\u4e0b\u89d2\u7684\u521b\u4f5c\u6309\u94ae\u6765\u9009\u62e9\u7ee7\u7eed\u5b8c\u5584\u8fd9\u4e2a\u4f5c\u54c1\u6216\u8005\u5f00\u59cb\u521b\u4f5c\u65b0\u4f5c\u54c1\u3002")
                    }
                    appPreferences.edit()
                        .putString(PREF_LAST_COMPLETED_GENERATION_ID, snapshot.generationId)
                        .apply()
                }
                GenerationForegroundService.STATUS_FAILED,
                GenerationForegroundService.STATUS_AWAITING_RESULT -> {
                    activeGenerationId = null
                    generationState = snapshot.asFailureState()
                    selectedTab = AiyaTab.Play
                    // Keep failed task evidence until the next request overwrites it.
                }
                else -> {
                    activeGenerationId = null
                    generationState = if (currentWork != null) GenerationState.Ready else GenerationState.Idle
                    clearBackgroundGenerationSnapshot(context.applicationContext)
                }
            }
        }

        fun recoverOriginalGeneration() {
            val snapshot = readBackgroundGenerationSnapshot(context.applicationContext) ?: return
            if (!generationNeedsRecovery(snapshot.status, snapshot.message)) return
            if (snapshot.status != GenerationForegroundService.STATUS_RUNNING) {
                autoRecoveryAttemptedTaskId = snapshot.generationId
            }
            try {
                ContextCompat.startForegroundService(
                    context.applicationContext,
                    Intent(context.applicationContext, GenerationForegroundService::class.java)
                        .setAction(GenerationForegroundService.ACTION_RECOVER)
                        .putExtra(GenerationForegroundService.EXTRA_GENERATION_ID, snapshot.generationId),
                )
                activeGenerationId = snapshot.generationId
                generationState = GenerationState.Loading(snapshot.idea, snapshot.generationId,
                    "正在取回原任务结果，不会重新生成。", snapshot.startedAt, snapshot.buildExecutionJson)
                selectedTab = AiyaTab.Play
            } catch (error: Exception) {
                Log.w(AIYA_LOG_TAG, "could not recover generation id=${snapshot.generationId}", error)
                Toast.makeText(context, "暂时无法启动恢复，请稍后点击恢复原任务。", Toast.LENGTH_LONG).show()
            }
        }

        // Resume a killed worker from durable task identity using GET only.
        // Keep the latest callbacks: a lifecycle observer must not capture stale
        // Compose state when a user starts a new task or cancels the old one.
        val resumeGeneration by rememberUpdatedState(newValue = { recoverOriginalGeneration() })
        val reconcileGeneration by rememberUpdatedState(newValue = { reconcileBackgroundGeneration() })
        DisposableEffect(context) {
            val lifecycle = (context as? ComponentActivity)?.lifecycle
            val observer = LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) {
                    autoRecoveryAttemptedTaskId = ""
                    reconcileGeneration()
                    resumeGeneration()
                }
            }
            lifecycle?.addObserver(observer)
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
            val networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    mainHandler.post {
                        if (lifecycle?.currentState?.isAtLeast(Lifecycle.State.RESUMED) == true) {
                            val snapshot = readBackgroundGenerationSnapshot(context.applicationContext)
                            if (snapshot != null && snapshot.status != GenerationForegroundService.STATUS_RUNNING &&
                                generationNeedsRecovery(snapshot.status, snapshot.message)) resumeGeneration()
                        }
                    }
                }
            }
            val networkRegistered = runCatching { connectivity.registerDefaultNetworkCallback(networkCallback) }.isSuccess
            onDispose {
                lifecycle?.removeObserver(observer)
                if (networkRegistered) runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
            }
        }

        val uncertainTaskId = (generationState as? GenerationState.Failed)?.recoveryTaskId.orEmpty()
        LaunchedEffect(uncertainTaskId) {
            // A suspended worker may wake on ON_RESUME and only then notice its
            // old deadline. Recover that newly uncertain result once, not in an
            // infinite 9-minute retry loop while the phone remains offline.
            val resumed = (context as? ComponentActivity)?.lifecycle?.currentState
                ?.isAtLeast(Lifecycle.State.RESUMED) == true
            if (uncertainTaskId.isNotBlank() && resumed && autoRecoveryAttemptedTaskId != uncertainTaskId) {
                autoRecoveryAttemptedTaskId = uncertainTaskId
                resumeGeneration()
            }
        }

        DisposableEffect(context) {
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(receiverContext: Context?, intent: Intent?) {
                    if (intent?.action == BACKGROUND_GENERATION_CHANGED_ACTION) {
                        reconcileBackgroundGeneration()
                    }
                }
            }
            ContextCompat.registerReceiver(
                context,
                receiver,
                IntentFilter(BACKGROUND_GENERATION_CHANGED_ACTION),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            reconcileBackgroundGeneration()
            onDispose { context.unregisterReceiver(receiver) }
        }

        LaunchedEffect(activeGenerationId) {
            while (activeGenerationId != null) {
                delay(750)
                reconcileBackgroundGeneration()
            }
        }

        DisposableEffect(teacherVoiceController) {
            if (!welcomeVoiceStarted) {
                welcomeVoiceStarted = true
                speakTeacher(TEACHER_WELCOME_TEXT)
            }
            onDispose { }
        }

        fun selectWork(work: GeneratedWork, destinationTab: AiyaTab = AiyaTab.Play) {
            val normalized = ensureWorkIdentity(work, fallbackIdea = work.sourceIdea, previousWork = work)
            currentWork = normalized
            generationState = GenerationState.Ready
            exportState = ExportState.Idle
            setActiveWork(context.applicationContext, normalized)
            selectedTab = destinationTab
        }

        fun startNewWork() {
            currentWork = null
            continueCurrentWorkChosen = false
            generationState = GenerationState.Idle
            activeGenerationId = null
            exportState = ExportState.Idle
            idea = ""
            clearActiveWork(context.applicationContext)
            selectedTab = AiyaTab.Create
        }

        fun openCreateFromPlay() {
            selectedTab = AiyaTab.Create
            if (currentWork == null) return
            showCreateEntryChoice = true
        }

        fun continueCurrentWork() {
            showCreateEntryChoice = false
            continueCurrentWorkChosen = true
            selectedTab = AiyaTab.Create
            speakTeacher("\u597d\u7684\uff0c\u6211\u4eec\u7ee7\u7eed\u5b8c\u5584\u5f53\u524d\u4f5c\u54c1\u3002\u8bf7\u544a\u8bc9\u6211\u65b0\u7684\u60f3\u6cd5\u3002")
        }

        fun startNewWorkFromChoice() {
            showCreateEntryChoice = false
            continueCurrentWorkChosen = false
            startNewWork()
            speakTeacher("\u597d\u7684\uff0c\u6211\u4eec\u4ece\u5934\u5f00\u59cb\u4e00\u4e2a\u65b0\u4f5c\u54c1\u3002\u8bf7\u544a\u8bc9\u6211\u60f3\u505a\u4ec0\u4e48\u3002")
        }

        fun cancelGeneration() {
            val loading = generationState as? GenerationState.Loading ?: return
            cancelBackgroundGeneration(context.applicationContext, loading.generationId)
            activeGenerationId = null
            generationState = if (currentWork != null) GenerationState.Ready else GenerationState.Idle
            idea = loading.idea
            selectedTab = AiyaTab.Create
            stopTeacherVoice()
        }

        fun deleteWork(work: GeneratedWork) {
            if (exportState is ExportState.Working) return
            val deletedTitle = work.title.ifBlank { "AIYA 作品" }
            val result = deleteWorkFromLibrary(
                context = context.applicationContext,
                deletingWorkId = work.id,
                currentWork = currentWork,
                currentLibrary = workLibrary,
            )
            workLibrary = result.library
            currentWork = result.activeWork
            generationState = if (result.activeWork != null) GenerationState.Ready else GenerationState.Idle
            exportState = ExportState.Done(
                if (result.activeWork == null) "已删除项目：$deletedTitle。现在可以新建作品。"
                else "已删除项目：$deletedTitle。"
            )
            selectedTab = AiyaTab.Export
        }

        fun rollbackCurrentWork() {
            val active = currentWork ?: return
            val previous = readPreviousWorkVersion(context.applicationContext, active.id)
            if (previous == null) {
                Toast.makeText(context, "没有可回退的上一版。", Toast.LENGTH_SHORT).show()
                return
            }
            savePreviousWorkVersion(context.applicationContext, active)
            val restored = previous.copy(id = active.id, updatedAt = System.currentTimeMillis())
            val nextLibrary = (listOf(restored) + workLibrary.filter { it.id != restored.id })
                .sortedByDescending { it.updatedAt }
                .take(MAX_STORED_WORKS)
            persistWorkLibrary(context.applicationContext, nextLibrary, restored.id)
            writeLatestWork(context.applicationContext, restored)
            workLibrary = nextLibrary
            currentWork = restored
            generationState = GenerationState.Ready
            exportState = ExportState.Idle
            Toast.makeText(context, "已回退到上一版。", Toast.LENGTH_SHORT).show()
            speakTeacher("已经回退到上一版作品。")
        }

        fun loadShowcaseWorks() {
            showcaseState = ShowcaseState.Loading
            Thread {
                val result = runCatching { fetchShowcaseWorks() }
                mainHandler.post {
                    showcaseState = result.fold(
                        onSuccess = { ShowcaseState.Ready(it) },
                        onFailure = { ShowcaseState.Failed(it.message ?: "优秀作品加载失败。") },
                    )
                }
            }.apply {
                name = "aiya-v3-showcase-loader"
                isDaemon = true
                start()
            }
        }

        fun openShowcase() {
            showShowcase = true
            loadShowcaseWorks()
        }

        fun generateWork(requestIdea: String) {
            val trimmedIdea = requestIdea.trim()
            if (trimmedIdea.isBlank() || generationState is GenerationState.Loading) return
            val startFreshWork = !continueCurrentWorkChosen || shouldStartFreshWork(trimmedIdea, currentWork)
            val previousWork = if (startFreshWork) null else currentWork
            val generationId = createGenerationId()
            val requestModelMode = selectedModelMode
            modelSelectionRequestId += 1 // Ignore a late availability check once a task has started.
            val estimatedCodingTime = estimateCodingTimeLabel(trimmedIdea, previousWork, requestModelMode)
            // New tasks use the visible model choice; legacy pending snapshots keep their own routing fields.
            hasLocalModelMode = true
            appPreferences.edit().putString(PREF_MODEL_MODE, requestModelMode.id).apply()
            activeGenerationId = generationId
            generationState = GenerationState.Loading(trimmedIdea, generationId)
            selectedTab = AiyaTab.Play
            speakTeacher(
                (if (previousWork != null) "收到，我会在当前作品基础上继续完善。"
                else "收到，我开始把你的想法做成一个新作品。") +
                    "根据需求复杂度，预计编码时间约${estimatedCodingTime}，完成后我会马上提醒你。"
            )
            runCatching {
                startBackgroundGeneration(
                    context.applicationContext,
                    BackgroundGenerationRequest(
                        generationId = generationId,
                        idea = trimmedIdea,
                        previousWorkId = previousWork?.id,
                        modelModeId = requestModelMode.id,
                        buildPreferenceId = BuildPreference.Auto.id,
                        manualModel = true,
                    ),
                )
            }.onFailure { error ->
                Log.e(AIYA_LOG_TAG, "could not enqueue background generation id=$generationId", error)
                activeGenerationId = null
                generationState = GenerationState.Failed(
                    message = error.message ?: "\u65e0\u6cd5\u542f\u52a8\u540e\u53f0\u751f\u6210\u3002",
                    lastIdea = trimmedIdea,
                )
                selectedTab = AiyaTab.Play
            }
        }

        fun startVoiceInputNow() {
            if (generationState is GenerationState.Loading) return
            voiceController.start(
                onState = { voiceUiState = it },
                onCommit = { recognized ->
                    val requestIdea = buildVoiceRequestIdea(recognized)
                    if (requestIdea.isNotBlank()) {
                        idea = requestIdea
                        generateWork(requestIdea)
                    }
                },
            )
        }

        val microphonePermissionLauncher = rememberLauncherForActivityResult(
            contract = ActivityResultContracts.RequestPermission(),
        ) { granted ->
            val wasWaitingForVoice = pendingVoiceStart
            pendingVoiceStart = false
            voiceUiState = if (granted && wasWaitingForVoice) {
                VoiceUiState(VoiceStatus.PermissionReady)
            } else {
                VoiceUiState(VoiceStatus.Error("需要麦克风权限才能语音输入。"))
            }
        }

        fun startVoiceInput() {
            if (generationState is GenerationState.Loading) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
                context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
            ) {
                pendingVoiceStart = true
                voiceUiState = VoiceUiState(VoiceStatus.Error("允许麦克风后就能说。"))
                microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                return
            }
            startVoiceInputNow()
        }

        fun stopVoiceInput() {
            voiceController.stop()
        }

        fun runExportTask(
            workingMessage: String,
            onCompleted: (ExportTaskResult) -> Unit = {},
            task: () -> ExportTaskResult,
        ) {
            if (exportState is ExportState.Working) return
            exportState = ExportState.Working(workingMessage)
            Log.i(AIYA_LOG_TAG, "export started action=$workingMessage")
            Thread {
                val result = runCatching { task() }
                mainHandler.post {
                    result.onSuccess { taskResult ->
                        Log.i(AIYA_LOG_TAG, "export completed action=$workingMessage message=${taskResult.message}")
                        exportState = ExportState.Done(taskResult.message)
                        Toast.makeText(context, taskResult.message, Toast.LENGTH_LONG).show()
                        taskResult.installFile?.let { installFile ->
                            runCatching { openApkInstaller(context.applicationContext, installFile) }
                                .onFailure { error ->
                                    Log.e(AIYA_LOG_TAG, "generated-apk installer failed file=${installFile.name}", error)
                                    exportState = ExportState.Failed(error.message ?: "无法打开系统安装页面。")
                                    Toast.makeText(
                                        context,
                                        error.message ?: "无法打开系统安装页面。",
                                        Toast.LENGTH_LONG,
                                    ).show()
                                }
                        }
                        taskResult.shareFile?.let { shareFile ->
                            runCatching { shareHtmlFile(context.applicationContext, shareFile) }
                                .onFailure { error ->
                                    Log.e(AIYA_LOG_TAG, "html share failed file=${shareFile.name}", error)
                                    exportState = ExportState.Failed(error.message ?: "无法打开分享面板。")
                                    Toast.makeText(
                                        context,
                                        error.message ?: "无法打开分享面板。",
                                        Toast.LENGTH_LONG,
                                    ).show()
                                }
                        }
                        if (exportState !is ExportState.Failed) onCompleted(taskResult)
                    }.onFailure { error ->
                        val message = error.message ?: "操作失败，请重试。"
                        Log.e(AIYA_LOG_TAG, "export failed action=$workingMessage message=$message", error)
                        exportState = ExportState.Failed(message)
                        Toast.makeText(context, message, Toast.LENGTH_LONG).show()
                    }
                }
            }.apply {
                name = "aiya-v3-export-${workingMessage.hashCode()}"
                isDaemon = true
                start()
            }
        }

        fun saveHtml(work: GeneratedWork) {
            speakTeacher("好的，我来把这个作品保存成 HTML 文件。")
            runExportTask(
                workingMessage = "正在保存 HTML",
                onCompleted = { speakTeacher("HTML 文件已经保存到下载目录了。") },
            ) {
                ExportTaskResult(
                    message = saveBytesToDownloads(
                        context = context.applicationContext,
                        filename = "${safeFileStem(work.title)}.html",
                        mimeType = "text/html",
                        bytes = work.html.toByteArray(Charsets.UTF_8),
                    ),
                )
            }
        }

        fun shareHtmlToWechat(work: GeneratedWork) {
            speakTeacher("我来准备 HTML 文件并打开微信分享，你可以选择联系人发送。")
            runExportTask(
                workingMessage = "正在准备微信分享",
                onCompleted = {
                    speakTeacher("HTML 文件已经准备好了，已打开微信分享，请选择联系人。")
                },
            ) {
                val filename = "${safeFileStem(work.title)}.html"
                val saveMessage = saveBytesToDownloads(
                    context = context.applicationContext,
                    filename = filename,
                    mimeType = "text/html",
                    bytes = work.html.toByteArray(Charsets.UTF_8),
                )
                ExportTaskResult(
                    message = "$saveMessage，正在打开微信分享。",
                    shareFile = createHtmlShareFile(context.applicationContext, filename, work.html),
                )
            }
        }

        fun copySource(work: GeneratedWork) {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText("${work.title}.html", work.html))
            exportState = ExportState.Done("源码已复制到剪贴板")
            Toast.makeText(context, "源码已复制到剪贴板", Toast.LENGTH_SHORT).show()
            speakTeacher("源码已经复制好了。")
        }

        fun generateApk(work: GeneratedWork) {
            speakTeacher("好的，我正在生成 APK，完成后会打开安装页面。")
            runExportTask(
                workingMessage = "正在生成 APK",
                onCompleted = { speakTeacher("APK 已经生成好了，系统安装页面已经打开。") },
            ) {
                buildAndPrepareWorkApk(context.applicationContext, work)
            }
        }

        fun downloadAppUpdate(manifest: AppUpdateManifest) {
            if (appUpdateState is AppUpdateState.Downloading) return
            appUpdateState = AppUpdateState.Downloading(manifest.versionName)
            Thread {
                val result = runCatching { downloadAppUpdate(context.applicationContext, manifest) }
                mainHandler.post {
                    appUpdateState = result.fold(
                        onSuccess = { AppUpdateState.Downloaded(it) },
                        onFailure = { AppUpdateState.Failed(friendlyUpdateDownloadError(it), manifest) },
                    )
                }
            }.start()
        }

        fun checkForAppUpdateManually() {
            if (appUpdateState is AppUpdateState.Checking || appUpdateState is AppUpdateState.Downloading) return
            appUpdateState = AppUpdateState.Checking
            Toast.makeText(context, "正在检查 AIYA 更新", Toast.LENGTH_SHORT).show()
            Thread {
                val result = runCatching { checkForAppUpdateWithRetry() }
                mainHandler.post {
                    result.onSuccess { manifest ->
                        if (manifest == null) {
                            appUpdateState = AppUpdateState.Current(BuildConfig.VERSION_NAME)
                            Toast.makeText(context, "当前已是最新版本", Toast.LENGTH_SHORT).show()
                        } else {
                            appUpdateState = AppUpdateState.Available(manifest)
                            Toast.makeText(context, "发现新版本，开始下载", Toast.LENGTH_SHORT).show()
                            downloadAppUpdate(manifest)
                        }
                    }.onFailure { error ->
                        val message = friendlyUpdateCheckError(error)
                        appUpdateState = AppUpdateState.Failed(message)
                        Toast.makeText(context, message, Toast.LENGTH_LONG).show()
                    }
                }
            }.apply {
                name = "aiya-v3-manual-update-check"
                isDaemon = true
                start()
            }
        }

        if (showShowcase) {
            ShowcaseScreen(
                state = showcaseState,
                onBack = { showShowcase = false },
                onRetry = { loadShowcaseWorks() },
            )
        } else Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            bottomBar = {
                NavigationBar(
                    containerColor = Color.White,
                    tonalElevation = 0.dp,
                ) {
                    AiyaTab.entries.forEach { tab ->
                        NavigationBarItem(
                            selected = selectedTab == tab,
                            onClick = {
                                if (tab == AiyaTab.Create && selectedTab == AiyaTab.Play) {
                                    openCreateFromPlay()
                                } else if (tab == AiyaTab.Play && currentWork == null && workLibrary.isNotEmpty()) {
                                    selectWork(workLibrary.first(), AiyaTab.Play)
                                } else {
                                    selectedTab = tab
                                }
                            },
                            icon = {
                                TabIcon(
                                    tab = tab,
                                    selected = selectedTab == tab,
                                    isGenerating = tab == AiyaTab.Play && generationState is GenerationState.Loading,
                                )
                            },
                            label = {
                                Text(if (tab == AiyaTab.Play && generationState is GenerationState.Loading) "制作中" else tab.label)
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = Color.White,
                                selectedTextColor = AiyaGreen,
                                indicatorColor = Color.Transparent,
                                unselectedIconColor = Color(0xFF72827C),
                                unselectedTextColor = Color(0xFF72827C),
                            )
                        )
                    }
                }
            }
        ) { innerPadding ->
            Surface(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
                color = MaterialTheme.colorScheme.background,
            ) {
                Column(modifier = Modifier.fillMaxSize()) {
                    if (appUpdateState !is AppUpdateState.Idle && appUpdateState !is AppUpdateState.Checking && appUpdateState !is AppUpdateState.Current) {
                        Box(modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
                            AppUpdatePanel(state = appUpdateState, onDownload = { manifest -> downloadAppUpdate(manifest) })
                        }
                    }
                    Box(modifier = Modifier.fillMaxSize().weight(1f)) {
                        when (selectedTab) {
                    AiyaTab.Create -> CreateTab(
                        idea = idea,
                        isGenerating = generationState is GenerationState.Loading,
                        voiceUiState = voiceUiState,
                        teacherVoiceUiState = teacherVoiceUiState,
                        teacherProfile = teacherProfile,
                        selectedModelMode = selectedModelMode,
                        hasCurrentWork = currentWork != null && continueCurrentWorkChosen,
                        currentWorkTitle = currentWork?.title.orEmpty(),
                        showCreateEntryChoice = showCreateEntryChoice,
                        onContinueCurrentWork = { continueCurrentWork() },
                        onStartNewWork = { startNewWorkFromChoice() },
                        onIdeaChange = { idea = it },
                        onGenerate = { generateWork(idea) },
                        onExample = { example ->
                            if (currentWork != null && continueCurrentWorkChosen) startNewWork()
                            idea = example
                        },
                        onVoiceStart = { startVoiceInput() },
                        onVoiceStop = { stopVoiceInput() },
                        onReplayTeacherVoice = { speakTeacher(TEACHER_WELCOME_TEXT) },
                        onStopTeacherVoice = { stopTeacherVoice() },
                        onModelModeSelected = { mode -> selectModelMode(mode) },
                        onVersionClick = { checkForAppUpdateManually() },
                        displayName = displayName,
                        onDisplayNameChange = { updateDisplayName(it) },
                    )
                    AiyaTab.Play -> PlayTab(
                        work = currentWork,
                        workLibrary = workLibrary,
                        generationState = generationState,
                        onCancelGeneration = { cancelGeneration() },
                        onBackToCreate = { openCreateFromPlay() },
                        onSelectWork = { work -> selectWork(work, AiyaTab.Play) },
                        canRollback = currentWork?.let { hasPreviousWorkVersion(context.applicationContext, it.id) } == true,
                        onRollback = { rollbackCurrentWork() },
                        onRecover = { recoverOriginalGeneration() },
                        onRetry = { failedIdea ->
                            idea = failedIdea
                            generateWork(failedIdea)
                        },
                    )
                    AiyaTab.Export -> ExportTab(
                        work = currentWork,
                        workLibrary = workLibrary,
                        exportState = exportState,
                        onSaveHtml = { work -> saveHtml(work) },
                        onShareHtml = { work -> shareHtmlToWechat(work) },
                        onBuildApk = { work -> generateApk(work) },
                        onViewSource = { work ->
                            sourceViewerWork = work
                            speakTeacher("这是作品的完整源码，左右和上下都可以滑动查看，需要时可以点一键复制。")
                        },
                        onSelectWork = { work -> selectWork(work, AiyaTab.Export) },
                        onDeleteWork = { work -> deleteWork(work) },
                        onCreateFirst = { selectedTab = AiyaTab.Create },
                        onOpenShowcase = { openShowcase() },
                    )
                        }
                    }
                }
            }
        }
        sourceViewerWork?.let { work ->
            SourceViewerDialog(
                work = work,
                onDismiss = { sourceViewerWork = null },
                onCopy = { copySource(work) },
            )
        }
    }
}

private fun requestTeacherCoder(
    context: Context,
    clientTaskId: String,
    idea: String,
    currentWork: GeneratedWork?,
    modelMode: GenerationModelMode,
    buildPreference: BuildPreference,
    manualModel: Boolean,
    recoveryOnly: Boolean = false,
    generationBudgetMs: Long = 540_000L,
    initialBuildJson: String = "",
    onProgress: (GenerationProgress) -> Unit = {},
): GeneratedWork {
    val deviceId = getAiyaAuditDeviceId(context)
    val displayName = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(PREF_DISPLAY_NAME, "")
        .orEmpty()
        .trim()
        .ifBlank { "${Build.MANUFACTURER} ${Build.MODEL}".trim() }
    val payload = JSONObject()
        .put("idea", idea)
        .put("modelMode", modelMode.id)
        .put("buildPreference", buildPreference.id)
        .put("modelSelectionMode", if (manualModel) "manual" else "auto")
        .put(
            "taskContext",
            JSONObject()
                .put("clientTaskId", clientTaskId)
                .put("userId", "android:$deviceId")
                .put("userName", displayName)
                .put("deviceId", deviceId)
                .put("sessionId", AIYA_RUNTIME_SESSION_ID)
                .put("source", "android-v3")
                .put("appId", V3_APP_ID)
                .put("appVersion", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        )
        .put(
            "deviceContext",
            JSONObject()
                .put("surface", "mobile")
                .put("pointer", "coarse")
                .put("touch", true)
                .put("isApk", true)
        )

    if (currentWork != null) {
        payload.put(
            "currentApp",
            JSONObject()
                .put("id", currentWork.id)
                .put("title", currentWork.title)
                .put("brief", currentWork.brief)
                .put("html", currentWork.html)
                .put("model", currentWork.model)
        )
    } else {
        payload.put("currentApp", JSONObject.NULL)
    }

    val recoveryUrl = "$TEACHER_CODER_URL?clientTaskId=${URLEncoder.encode(clientTaskId, Charsets.UTF_8.name())}" +
        "&deviceId=${URLEncoder.encode(deviceId, Charsets.UTF_8.name())}"
    val json = awaitRecoverableGeneration(
        submit = { exchangeGenerationHttp(TEACHER_CODER_URL, payload.toString()) },
        poll = { remaining -> exchangeGenerationHttp(recoveryUrl, remainingMs = remaining) },
        onProgress = onProgress,
        resumeOnly = recoveryOnly,
        timeoutMs = generationBudgetMs,
        initialProgress = GenerationProgress(if (recoveryOnly) "正在取回原任务结果，不会重新生成。" else "正在提交需求。", initialBuildJson),
    )
    val result = json.getJSONObject("result")
    return GeneratedWork(
        id = result.optString("id", ""),
        title = result.optString("title", "AIYA 作品"),
        brief = result.optString("brief", "已生成可试玩作品。"),
        html = result.getString("html"),
        reply = json.optString("reply", "作品做好了，可以试玩。"),
        model = result.optString("model", json.optString("model", "aiya-v3")),
        buildExecutionJson = json.optJSONObject("build")?.toString().orEmpty(),
    )
}

private fun getAiyaAuditDeviceId(context: Context): String {
    val androidId = runCatching {
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
    }.getOrNull()?.trim().orEmpty()
    if (androidId.isNotBlank() && androidId != "9774d56d682e549c") return "android-$androidId"
    val preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val existing = preferences.getString(PREF_AUDIT_DEVICE_ID, "")?.trim().orEmpty()
    if (existing.isNotBlank()) return existing
    val created = "install-${UUID.randomUUID()}"
    preferences.edit().putString(PREF_AUDIT_DEVICE_ID, created).apply()
    return created
}

private fun isFusionConfiguredOnServer(): Boolean {
    val connection = (URL("$AIYA_ORIGIN/api/create-theatre/model-selection").openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 8_000
        readTimeout = 8_000
        useCaches = false
    }
    try {
        check(connection.responseCode == HttpURLConnection.HTTP_OK) { "模型状态检查失败" }
        val json = JSONObject(connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() })
        val options = json.optJSONArray("options") ?: return false
        return json.optBoolean("ok") && (0 until options.length()).any { index ->
            val option = options.optJSONObject(index)
            option?.optString("mode") == "fusion" && option.optString("model") == "fusion-max-2.0" && option.optBoolean("configured")
        }
    } finally {
        connection.disconnect()
    }
}

private fun fetchClassroomRuntimeSettings(): ClassroomRuntimeSettings {
    val connection = (URL(CLASSROOM_SETTINGS_URL).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 8_000
        readTimeout = 15_000
        setRequestProperty("Accept", "application/json")
    }
    try {
        val json = readJsonResponse(connection)
        return parseClassroomRuntimeSettings(json.optJSONObject("settings"))
    } finally {
        connection.disconnect()
    }
}

private fun parseClassroomRuntimeSettings(settingsJson: JSONObject?): ClassroomRuntimeSettings {
    val teacherJson = settingsJson?.optJSONObject("teacher")
    return ClassroomRuntimeSettings(
        teacherProfile = normalizeTeacherProfile(
            TeacherProfile(
                name = teacherJson?.optString("name", "AIYA老师").orEmpty().ifBlank { "AIYA老师" },
                avatar = teacherJson?.optString("avatar", "师").orEmpty().ifBlank { "师" },
            )
        ),
        modelMode = GenerationModelMode.fromId(settingsJson?.optString("modelMode", GenerationModelMode.Default.id)),
    )
}

private fun readLatestWork(context: Context): GeneratedWork? {
    val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_LATEST_WORK, "") ?: ""
    if (raw.isBlank()) return null
    return runCatching { parseGeneratedWork(context, JSONObject(raw)) }.getOrNull()
}

private fun writeLatestWork(context: Context, work: GeneratedWork) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_LATEST_WORK, workToJson(context, work).toString())
        .apply()
}

private fun readWorkLibrary(context: Context): List<GeneratedWork> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(PREF_WORK_LIBRARY, "") ?: ""
    val fromLibrary = if (raw.isBlank()) {
        emptyList()
    } else {
        runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    val work = parseGeneratedWork(context, array.optJSONObject(index) ?: continue) ?: continue
                    add(work)
                }
            }
        }.getOrDefault(emptyList())
    }

    val normalized = fromLibrary
        .filter { it.html.isNotBlank() }
        .distinctBy { it.id }
        .sortedByDescending { it.updatedAt }
        .take(MAX_STORED_WORKS)

    if (normalized.isNotEmpty()) return normalized

    val legacy = readLatestWork(context) ?: return emptyList()
    val migrated = ensureWorkIdentity(legacy, fallbackIdea = legacy.sourceIdea, previousWork = legacy)
    persistWorkLibrary(context, listOf(migrated), migrated.id)
    return listOf(migrated)
}

private fun readActiveWork(context: Context, library: List<GeneratedWork>): GeneratedWork? {
    if (library.isEmpty()) return null
    val activeId = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(PREF_ACTIVE_WORK_ID, "")
        .orEmpty()
    return library.firstOrNull { it.id == activeId } ?: library.firstOrNull()
}

private fun setActiveWork(context: Context, work: GeneratedWork) {
    val active = ensureWorkIdentity(work, fallbackIdea = work.sourceIdea, previousWork = work)
    writeLatestWork(context, active)
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_ACTIVE_WORK_ID, active.id)
        .apply()
}

private fun clearActiveWork(context: Context) {
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .remove(PREF_ACTIVE_WORK_ID)
        .apply()
}

private fun writeBackgroundGenerationRequest(context: Context, request: BackgroundGenerationRequest) {
    val json = JSONObject()
        .put("generationId", request.generationId)
        .put("idea", request.idea)
        .put("previousWorkId", request.previousWorkId ?: JSONObject.NULL)
        .put("modelModeId", request.modelModeId)
        .put("buildPreferenceId", request.buildPreferenceId)
        .put("manualModel", request.manualModel)
    saveWorkHtmlEncrypted(context, BACKGROUND_GENERATION_REQUEST_FILE_ID, json.toString())
}

private fun readBackgroundGenerationRequest(context: Context): BackgroundGenerationRequest? {
    val raw = readWorkHtmlEncrypted(context, BACKGROUND_GENERATION_REQUEST_FILE_ID).orEmpty()
    return runCatching {
        val json = JSONObject(raw)
        val generationId = json.optString("generationId").trim()
        val idea = json.optString("idea").trim()
        if (generationId.isBlank() || idea.isBlank()) null else BackgroundGenerationRequest(
            generationId = generationId,
            idea = idea,
            previousWorkId = json.optString("previousWorkId").trim().ifBlank { null },
            modelModeId = json.optString("modelModeId", GenerationModelMode.Default.id),
            buildPreferenceId = json.optString("buildPreferenceId", "auto"),
            manualModel = json.optBoolean("manualModel", true),
        )
    }.getOrNull()
}

private fun clearBackgroundGenerationRequest(context: Context) {
    deleteWorkHtmlEncrypted(context, BACKGROUND_GENERATION_REQUEST_FILE_ID)
}

private fun writeBackgroundGenerationSnapshot(context: Context, snapshot: BackgroundGenerationSnapshot) {
    val json = JSONObject()
        .put("generationId", snapshot.generationId)
        .put("idea", snapshot.idea)
        .put("status", snapshot.status)
        .put("message", snapshot.message)
        .put("completedAt", snapshot.completedAt)
        .put("startedAt", snapshot.startedAt)
        .put("buildExecutionJson", snapshot.buildExecutionJson)
    saveWorkHtmlEncrypted(context, BACKGROUND_GENERATION_SNAPSHOT_FILE_ID, json.toString())
}

private fun readBackgroundGenerationSnapshot(context: Context): BackgroundGenerationSnapshot? {
    val raw = readWorkHtmlEncrypted(context, BACKGROUND_GENERATION_SNAPSHOT_FILE_ID).orEmpty()
    return runCatching {
        val json = JSONObject(raw)
        val generationId = json.optString("generationId").trim()
        if (generationId.isBlank()) null else BackgroundGenerationSnapshot(
            generationId = generationId,
            idea = json.optString("idea"),
            status = json.optString("status"),
            message = json.optString("message"),
            completedAt = json.optLong("completedAt", 0L),
            startedAt = json.optLong("startedAt", System.currentTimeMillis()),
            buildExecutionJson = json.optString("buildExecutionJson", ""),
        )
    }.getOrNull()
}

private fun clearBackgroundGenerationSnapshot(context: Context) {
    deleteWorkHtmlEncrypted(context, BACKGROUND_GENERATION_SNAPSHOT_FILE_ID)
}

private fun notifyGenerationChanged(context: Context, generationId: String) {
    context.sendBroadcast(
        Intent(BACKGROUND_GENERATION_CHANGED_ACTION)
            .setPackage(context.packageName)
            .putExtra(GenerationForegroundService.EXTRA_GENERATION_ID, generationId),
    )
}

private fun startBackgroundGeneration(context: Context, request: BackgroundGenerationRequest) {
    writeBackgroundGenerationRequest(context, request)
    writeBackgroundGenerationSnapshot(
        context,
        BackgroundGenerationSnapshot(
            generationId = request.generationId,
            idea = request.idea,
            status = GenerationForegroundService.STATUS_RUNNING,
            message = "\u6b63\u5728\u540e\u53f0\u751f\u6210\u4f5c\u54c1\u3002",
        ),
    )
    ContextCompat.startForegroundService(
        context,
        Intent(context, GenerationForegroundService::class.java)
            .setAction(GenerationForegroundService.ACTION_START)
            .putExtra(GenerationForegroundService.EXTRA_GENERATION_ID, request.generationId),
    )
}

private fun cancelBackgroundGeneration(context: Context, generationId: String) {
    context.startService(
        Intent(context, GenerationForegroundService::class.java)
            .setAction(GenerationForegroundService.ACTION_CANCEL)
            .putExtra(GenerationForegroundService.EXTRA_GENERATION_ID, generationId),
    )
    clearBackgroundGenerationRequest(context)
}

private fun saveWorkToLibrary(
    context: Context,
    generatedWork: GeneratedWork,
    previousWork: GeneratedWork?,
    sourceIdea: String,
    currentLibrary: List<GeneratedWork>,
): SavedWorkLibraryResult {
    if (previousWork != null && previousWork.id.isNotBlank()) {
        savePreviousWorkVersion(context, previousWork)
    }
    val active = ensureWorkIdentity(
        work = generatedWork,
        fallbackIdea = sourceIdea,
        previousWork = previousWork,
    )
    val nextLibrary = (listOf(active) + currentLibrary.filter { it.id != active.id })
        .filter { it.html.isNotBlank() }
        .distinctBy { it.id }
        .sortedByDescending { it.updatedAt }
        .take(MAX_STORED_WORKS)

    persistWorkLibrary(context, nextLibrary, active.id)
    writeLatestWork(context, active)
    return SavedWorkLibraryResult(activeWork = active, library = nextLibrary)
}

private fun persistWorkLibrary(context: Context, library: List<GeneratedWork>, activeWorkId: String) {
    val array = JSONArray()
    library.take(MAX_STORED_WORKS).forEach { array.put(workToJson(context, it)) }
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(PREF_WORK_LIBRARY, array.toString())
        .putString(PREF_ACTIVE_WORK_ID, activeWorkId)
        .apply()
}

private fun deleteWorkFromLibrary(
    context: Context,
    deletingWorkId: String,
    currentWork: GeneratedWork?,
    currentLibrary: List<GeneratedWork>,
): DeleteWorkLibraryResult {
    deleteWorkHtmlEncrypted(context, deletingWorkId)
    clearPreviousWorkVersion(context, deletingWorkId)
    val nextLibrary = currentLibrary
        .filter { it.id != deletingWorkId }
        .sortedByDescending { it.updatedAt }
        .take(MAX_STORED_WORKS)
    val nextActiveWork = when {
        currentWork != null && currentWork.id != deletingWorkId -> nextLibrary.firstOrNull { it.id == currentWork.id } ?: nextLibrary.firstOrNull()
        else -> nextLibrary.firstOrNull()
    }

    if (nextActiveWork == null) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(PREF_WORK_LIBRARY)
            .remove(PREF_ACTIVE_WORK_ID)
            .remove(PREF_LATEST_WORK)
            .apply()
    } else {
        persistWorkLibrary(context, nextLibrary, nextActiveWork.id)
        writeLatestWork(context, nextActiveWork)
    }
    return DeleteWorkLibraryResult(activeWork = nextActiveWork, library = nextLibrary)
}

private fun previousVersionStorageId(workId: String): String = "version_${workId}_previous"

private fun savePreviousWorkVersion(context: Context, work: GeneratedWork) {
    if (work.id.isBlank() || work.html.isBlank()) return
    val storageId = previousVersionStorageId(work.id)
    saveWorkHtmlEncrypted(context, storageId, work.html)
    val metadata = JSONObject()
        .put("id", work.id)
        .put("title", work.title)
        .put("brief", work.brief)
        .put("reply", work.reply)
        .put("model", work.model)
        .put("buildExecutionJson", work.buildExecutionJson)
        .put("sourceIdea", work.sourceIdea)
        .put("createdAt", work.createdAt)
        .put("updatedAt", work.updatedAt)
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString("$PREF_PREVIOUS_VERSION_PREFIX${work.id}", metadata.toString())
        .apply()
}

private fun readPreviousWorkVersion(context: Context, workId: String): GeneratedWork? {
    if (workId.isBlank()) return null
    val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString("$PREF_PREVIOUS_VERSION_PREFIX$workId", "")
        .orEmpty()
    if (raw.isBlank()) return null
    return runCatching {
        val json = JSONObject(raw)
        val html = readWorkHtmlEncrypted(context, previousVersionStorageId(workId)).orEmpty()
        if (html.isBlank() || !looksLikeHtmlDocument(html)) return null
        GeneratedWork(
            id = workId,
            title = json.optString("title", "AIYA 作品").take(160),
            brief = json.optString("brief", "已生成可试玩作品。").take(400),
            html = html,
            reply = json.optString("reply", "作品已回退到上一版。").take(1200),
            model = json.optString("model", "aiya-v3").take(64),
        buildExecutionJson = json.optString("buildExecutionJson", ""),
            sourceIdea = json.optString("sourceIdea", "").take(1_200),
            createdAt = json.optLong("createdAt", System.currentTimeMillis()),
            updatedAt = json.optLong("updatedAt", System.currentTimeMillis()),
        )
    }.getOrNull()
}

private fun hasPreviousWorkVersion(context: Context, workId: String): Boolean {
    if (workId.isBlank()) return false
    val metadata = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString("$PREF_PREVIOUS_VERSION_PREFIX$workId", "")
        .orEmpty()
    return metadata.isNotBlank() && readWorkHtmlEncrypted(context, previousVersionStorageId(workId)) != null
}

private fun clearPreviousWorkVersion(context: Context, workId: String) {
    if (workId.isBlank()) return
    deleteWorkHtmlEncrypted(context, previousVersionStorageId(workId))
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .remove("$PREF_PREVIOUS_VERSION_PREFIX$workId")
        .apply()
}

private fun ensureWorkIdentity(
    work: GeneratedWork,
    fallbackIdea: String,
    previousWork: GeneratedWork?,
): GeneratedWork {
    val now = System.currentTimeMillis()
    val inheritedId = previousWork?.id?.takeIf { it.isNotBlank() }
    val ownId = work.id.takeIf { it.isNotBlank() }
    val id = inheritedId ?: ownId ?: createWorkId()
    val createdAt = when {
        previousWork != null && previousWork.id == id && previousWork.createdAt > 0L -> previousWork.createdAt
        work.createdAt > 0L -> work.createdAt
        previousWork?.createdAt != null && previousWork.createdAt > 0L -> previousWork.createdAt
        else -> now
    }
    return work.copy(
        id = id,
        sourceIdea = fallbackIdea.ifBlank { work.sourceIdea.ifBlank { previousWork?.sourceIdea.orEmpty() } },
        createdAt = createdAt,
        updatedAt = now,
    )
}

private fun parseGeneratedWork(context: Context, json: JSONObject): GeneratedWork? {
    val html = readWorkHtmlFromIndex(context, json)
    if (html.isBlank()) return null
    if (html.length < MIN_HTML_BYTES || html.length > MAX_HTML_BYTES) return null
    if (!looksLikeHtmlDocument(html)) return null
    val savedAt = json.optLong("updatedAt", json.optLong("savedAt", 0L))
    val createdAt = json.optLong("createdAt", savedAt)
    val id = json.optString("id").ifBlank {
        "legacy_${sha256Hex(html).take(12)}"
    }
    return GeneratedWork(
        id = id,
        title = json.optString("title", "AIYA 作品").take(160),
        brief = json.optString("brief", "已生成可试玩作品。").take(400),
        html = html,
        reply = json.optString("reply", "作品做好了，可以试玩。").take(1200),
        model = json.optString("model", "aiya-v3").take(64),
        buildExecutionJson = json.optString("buildExecutionJson", ""),
        sourceIdea = json.optString("sourceIdea", "").take(1_200),
        createdAt = createdAt,
        updatedAt = savedAt,
    )
}

private fun looksLikeHtmlDocument(html: String): Boolean {
    val head = html.take(512).lowercase()
    return head.contains("<!doctype html") || head.contains("<html")
}

private fun workToJson(context: Context, work: GeneratedWork): JSONObject {
    val safeId = work.id.ifBlank { "work_${System.currentTimeMillis()}" }
    if (work.html.isNotBlank()) {
        runCatching { saveWorkHtmlEncrypted(context, safeId, work.html) }
    }
    val json = JSONObject()
        .put("id", safeId)
        .put("title", work.title)
        .put("brief", work.brief)
        .put("htmlPath", "works/$safeId.bin")
        .put("htmlHash", sha256Hex(work.html))
        .put("htmlLength", work.html.length)
        .put("html", "")
        .put("reply", work.reply)
        .put("model", work.model)
        .put("buildExecutionJson", work.buildExecutionJson)
        .put("sourceIdea", work.sourceIdea)
        .put("createdAt", work.createdAt)
        .put("updatedAt", work.updatedAt)
        .put("savedAt", work.updatedAt)
    return json
}

private fun readWorkHtmlFromIndex(context: Context, json: JSONObject): String {
    val htmlPath = json.optString("htmlPath", "")
    val workId = json.optString("id", "")
    if (htmlPath.isNotBlank() && workId.isNotBlank()) {
        val fromFile = readWorkHtmlEncrypted(context, workId)
        if (!fromFile.isNullOrBlank()) {
            return fromFile
        }
    }
    // Legacy fallback: pre-fix builds stored the html inline.
    return json.optString("html", "")
}

private fun createWorkId(): String {
    return "work_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"
}

private fun createGenerationId(): String {
    return "gen_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"
}

private fun safeFileStem(value: String): String {
    val normalized = value.trim()
        .replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]+"), "-")
        .replace(Regex("\\s+"), "-")
        .trim('-')
        .take(48)
    return normalized.ifBlank { "AIYA-作品" }
}

private fun saveBytesToDownloads(
    context: Context,
    filename: String,
    mimeType: String,
    bytes: ByteArray,
): String {
    if (bytes.isEmpty()) throw IllegalStateException("文件内容为空。")
    val safeName = safeFileStem(filename.substringBeforeLast('.', filename))
    val extension = filename.substringAfterLast('.', "")
    val finalName = if (extension.isBlank()) safeName else "$safeName.$extension"

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, finalName)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/AIYA")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("无法创建下载文件。")
        try {
            resolver.openOutputStream(uri)?.use { output -> output.write(bytes) }
                ?: throw IllegalStateException("无法写入下载文件。")
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (error: Throwable) {
            resolver.delete(uri, null, null)
            throw error
        }
    } else {
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "AIYA")
        runCatching {
            if (!dir.exists() && !dir.mkdirs()) throw IllegalStateException("无法创建下载目录。")
            File(dir, finalName).writeBytes(bytes)
        }.getOrElse {
            val fallbackDir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "AIYA")
            if (!fallbackDir.exists() && !fallbackDir.mkdirs()) throw IllegalStateException("无法创建保存目录。")
            File(fallbackDir, finalName).writeBytes(bytes)
            return "已保存到 AIYA 应用文件/$finalName"
        }
    }
    return "已保存到 下载/AIYA/$finalName"
}

private fun createHtmlShareFile(context: Context, filename: String, html: String): File {
    val shareDir = File(context.cacheDir, "shared-html").apply { mkdirs() }
    val shareFile = File(shareDir, filename)
    shareFile.writeText(html, Charsets.UTF_8)
    return shareFile
}

private fun shareHtmlFile(context: Context, htmlFile: File) {
    if (!htmlFile.exists() || htmlFile.length() <= 0L) throw IllegalStateException("HTML 分享文件不存在。")
    val htmlUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        htmlFile,
    )
    val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "text/html"
        putExtra(Intent.EXTRA_STREAM, htmlUri)
        clipData = ClipData.newUri(context.contentResolver, htmlFile.name, htmlUri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val wechatIntent = Intent(shareIntent).setPackage("com.tencent.mm")
    val targetIntent = if (wechatIntent.resolveActivity(context.packageManager) != null) {
        wechatIntent
    } else {
        Intent.createChooser(shareIntent, "分享 HTML 文件").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(targetIntent)
    Log.i(AIYA_LOG_TAG, "html share opened file=${htmlFile.name} bytes=${htmlFile.length()}")
}

private fun buildAndPrepareWorkApk(context: Context, work: GeneratedWork): ExportTaskResult {
    val payload = JSONObject()
        .put("title", work.title.ifBlank { "AIYA 作品" })
        .put("html", work.html)
    Log.i(AIYA_LOG_TAG, "generated-apk job creating title=${work.title.take(80)} htmlBytes=${work.html.toByteArray().size}")
    val jobJson = postJson(APK_JOB_URL, payload)
    var job = jobJson.optJSONObject("job") ?: throw IllegalStateException("APK 任务返回为空。")
    val jobId = job.optString("id")
    if (jobId.isBlank()) throw IllegalStateException("APK 任务编号为空。")
    Log.i(AIYA_LOG_TAG, "generated-apk job created id=$jobId status=${job.optString("status")}")

    var attempt = 0
    while (attempt < 60) {
        val status = job.optString("status")
        Log.i(AIYA_LOG_TAG, "generated-apk job polling id=$jobId attempt=$attempt status=$status")
        when (status) {
            "succeeded" -> break
            "failed" -> throw IllegalStateException(job.optString("error", "APK 构建失败。"))
            else -> {
                Thread.sleep(1_000)
                job = getJson("$APK_JOB_URL/${jobId}").optJSONObject("job") ?: job
            }
        }
        attempt += 1
    }
    if (job.optString("status") != "succeeded") throw IllegalStateException("APK 仍在生成，请稍后再试。")

    val rawDownloadUrl = job.optString("downloadUrl")
    if (rawDownloadUrl.isBlank()) throw IllegalStateException("APK 下载地址为空。")
    val downloadUrl = if (rawDownloadUrl.startsWith("http")) rawDownloadUrl else "$AIYA_ORIGIN$rawDownloadUrl"
    val apkBytes = downloadBytes(downloadUrl, "application/vnd.android.package-archive")
    if (apkBytes.size < 4 || !apkBytes.copyOfRange(0, 2).contentEquals(byteArrayOf(0x50, 0x4B))) {
        throw IllegalStateException("服务器返回的 APK 文件无效。")
    }
    Log.i(AIYA_LOG_TAG, "generated-apk downloaded id=$jobId bytes=${apkBytes.size}")
    val filename = "${safeFileStem(work.title)}-$jobId.apk"
    val saveMessage = saveBytesToDownloads(
        context = context,
        filename = filename,
        mimeType = "application/vnd.android.package-archive",
        bytes = apkBytes,
    )
    val installDir = File(context.cacheDir, "generated-apks").apply { mkdirs() }
    val installFile = File(installDir, filename).apply { writeBytes(apkBytes) }
    Log.i(AIYA_LOG_TAG, "generated-apk ready id=$jobId saved=$filename installFile=${installFile.absolutePath}")
    return ExportTaskResult(
        message = "$saveMessage，正在打开系统安装页面",
        installFile = installFile,
    )
}

private fun openApkInstaller(context: Context, apkFile: File) {
    if (!apkFile.exists() || apkFile.length() <= 0L) throw IllegalStateException("APK 安装文件不存在。")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
        context.startActivity(
            Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        throw IllegalStateException("请允许 AIYA 安装未知应用，返回后再次点击生成 APK。")
    }
    val apkUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        apkFile,
    )
    context.startActivity(
        Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    )
    Log.i(AIYA_LOG_TAG, "generated-apk installer opened file=${apkFile.name} bytes=${apkFile.length()}")
}

private fun checkForAppUpdate(): AppUpdateManifest? {
    val url = "$UPDATE_URL?currentVersionCode=${BuildConfig.VERSION_CODE}&appId=$V3_APP_ID"
    val json = getJson(url)
    val update = json.optJSONObject("update")
    if (update?.optBoolean("available", false) != true) return null
    val manifest = json.optJSONObject("manifest") ?: return null
    val versionCode = manifest.optInt("versionCode", 0)
    val versionName = manifest.optString("versionName", "")
    val rawUrl = manifest.optString("apkUrl").ifBlank { manifest.optString("apkPath") }
    if (versionCode <= BuildConfig.VERSION_CODE || rawUrl.isBlank()) return null
    val apkUrl = if (rawUrl.startsWith("http")) rawUrl else "$AIYA_ORIGIN$rawUrl"
    return AppUpdateManifest(
        versionCode = versionCode,
        versionName = versionName.ifBlank { versionCode.toString() },
        apkUrl = apkUrl,
        filename = manifest.optString("filename", "aiya-v3-$versionName.apk"),
        message = manifest.optString("message", "发现 AIYA 新版本 $versionName"),
        apkSha256 = manifest.optString("apkSha256", "").lowercase(),
        apkBytes = manifest.optLong("apkBytes", 0L),
    )
}

private fun checkForAppUpdateWithRetry(maxAttempts: Int = 2): AppUpdateManifest? {
    var lastError: Throwable? = null
    repeat(maxAttempts.coerceAtLeast(1)) { attempt ->
        try {
            return checkForAppUpdate()
        } catch (error: Throwable) {
            lastError = error
            if (attempt < maxAttempts - 1) Thread.sleep(2_500L)
        }
    }
    throw lastError ?: IllegalStateException("更新检查暂时不可用")
}

private fun isTransientUpdateNetworkError(error: Throwable): Boolean {
    var current: Throwable? = error
    repeat(8) {
        when (current) {
            is ConnectException,
            is SocketException,
            is SocketTimeoutException,
            is UnknownHostException,
            is SSLException -> return true
        }
        current = current?.cause
    }
    return false
}

private fun friendlyUpdateCheckError(error: Throwable): String =
    if (isTransientUpdateNetworkError(error)) {
        "暂时无法检查更新，不影响正常使用。请检查网络后稍后重试。"
    } else {
        "更新检查暂时不可用，不影响正常使用。请稍后重试。"
    }

private fun friendlyUpdateDownloadError(error: Throwable): String {
    if (isTransientUpdateNetworkError(error)) {
        return "更新包下载中断，请检查网络后点击重试。"
    }
    val detail = error.message.orEmpty().trim()
    return if (detail.any { it in '\u4e00'..'\u9fff' }) detail.take(120)
    else "更新包暂时无法下载，请稍后点击重试。"
}

private fun downloadAppUpdate(context: Context, manifest: AppUpdateManifest): String {
    val updateDir = File(context.cacheDir, "updates").apply { mkdirs() }
    val updateFile = File(updateDir, "aiya-v3-update-${manifest.versionCode}.apk")
    downloadFileResumable(
        url = manifest.apkUrl,
        accept = "application/vnd.android.package-archive",
        target = updateFile,
        expectedBytes = manifest.apkBytes,
        expectedSha256 = manifest.apkSha256,
    )

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
        val settingsIntent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(settingsIntent)
        throw IllegalStateException("\u8bf7\u5141\u8bb8 AIYA \u5b89\u88c5\u672a\u77e5\u5e94\u7528\uff0c\u7136\u540e\u8fd4\u56de\u518d\u6b21\u70b9\u51fb\u66f4\u65b0\u3002")
    }

    val apkUri = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        updateFile,
    )
    val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(apkUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(installIntent)
    return "\u66f4\u65b0\u5305\u5df2\u4e0b\u8f7d\uff0c\u6b63\u5728\u6253\u5f00\u7cfb\u7edf\u5b89\u88c5\u5668\u3002"
}

private fun downloadFileResumable(
    url: String,
    accept: String,
    target: File,
    expectedBytes: Long,
    expectedSha256: String,
) {
    if (expectedBytes <= 0L) {
        target.writeBytes(downloadBytes(url, accept))
        return
    }
    val chunkBytes = 2L * 1024L * 1024L
    if (target.exists() && expectedBytes > 0L && target.length() > expectedBytes) target.delete()
    var lastError: Throwable? = null
    var failures = 0

    while (failures < 8) {
        val offset = target.takeIf { it.exists() }?.length() ?: 0L
        if (expectedBytes > 0L && offset == expectedBytes) {
            val actualSha256 = sha256FileHex(target)
            if (expectedSha256.isBlank() || actualSha256.equals(expectedSha256, ignoreCase = true)) return
            target.delete()
            failures += 1
            lastError = IllegalStateException("\u66f4\u65b0\u5305\u6821\u9a8c\u5931\u8d25\uff0c\u6b63\u5728\u91cd\u65b0\u4e0b\u8f7d\u3002")
            continue
        }

        val rangeEnd = if (expectedBytes > 0L) {
            minOf(offset + chunkBytes - 1L, expectedBytes - 1L)
        } else {
            offset + chunkBytes - 1L
        }
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Accept", accept)
            setRequestProperty("Accept-Encoding", "identity")
            setRequestProperty("Connection", "close")
            setRequestProperty("Range", "bytes=$offset-$rangeEnd")
        }
        try {
            val status = connection.responseCode
            if (status !in 200..299) {
                val error = connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                throw IllegalStateException(error.ifBlank { "\u66f4\u65b0\u5305\u5206\u6bb5\u4e0b\u8f7d\u5931\u8d25\uff1a$status" }.take(220))
            }
            if (offset > 0L && status != HttpURLConnection.HTTP_PARTIAL) {
                target.delete()
                throw IllegalStateException("\u670d\u52a1\u5668\u672a\u8fd4\u56de\u65ad\u70b9\u7eed\u4f20\u6570\u636e\uff0c\u5df2\u91cd\u7f6e\u4e0b\u8f7d\u3002")
            }
            val append = offset > 0L && status == HttpURLConnection.HTTP_PARTIAL
            FileOutputStream(target, append).use { output ->
                connection.inputStream.use { input -> input.copyTo(output, 64 * 1024) }
            }
            failures = 0
            Log.i(
                AIYA_LOG_TAG,
                "app-update chunk downloaded versionBytes=${target.length()}/$expectedBytes status=$status",
            )
            if (expectedBytes <= 0L && status == HttpURLConnection.HTTP_OK) return
        } catch (error: Throwable) {
            lastError = error
            failures += 1
            Log.w(
                AIYA_LOG_TAG,
                "app-update chunk failed attempt=$failures downloaded=${target.takeIf { it.exists() }?.length() ?: 0L}",
                error,
            )
            Thread.sleep((failures * 500L).coerceAtMost(3_000L))
        } finally {
            connection.disconnect()
        }
    }
    throw IllegalStateException(
        "\u66f4\u65b0\u4e0b\u8f7d\u591a\u6b21\u4e2d\u65ad\uff0c\u5df2\u4fdd\u7559\u8fdb\u5ea6\uff0c\u8bf7\u70b9\u51fb\u91cd\u8bd5\u7ee7\u7eed\u4e0b\u8f7d\u3002" +
            (lastError?.message?.take(80)?.let { " $it" } ?: ""),
    )
}

private fun sha256FileHex(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

private fun postJson(url: String, payload: JSONObject): JSONObject {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15_000
        readTimeout = 300_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json; charset=utf-8")
        setRequestProperty("Accept", "application/json")
    }
    try {
        connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        return readJsonResponse(connection)
    } finally {
        connection.disconnect()
    }
}

private fun getJson(url: String): JSONObject {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 15_000
        readTimeout = 60_000
        setRequestProperty("Accept", "application/json")
    }
    try {
        return readJsonResponse(connection)
    } finally {
        connection.disconnect()
    }
}

private fun fetchShowcaseWorks(): List<ShowcaseWork> {
    val payload = getJson("$AIYA_ORIGIN/api/create-theatre/showcase")
    val works = payload.optJSONArray("works") ?: JSONArray()
    return buildList {
        for (index in 0 until works.length()) {
            val item = works.optJSONObject(index) ?: continue
            val html = item.optString("html")
            if (html.isBlank()) continue
            val iconJson = item.optJSONObject("icon")
            val icon = iconJson?.let {
                ShowcaseIcon(
                    symbol = it.optString("symbol", "utility").take(32),
                    palette = it.optString("palette", "mint").take(32),
                )
            }
            add(
                ShowcaseWork(
                    id = item.optString("id").ifBlank { "showcase-$index" },
                    title = item.optString("title", "AIYA 作品").take(80),
                    brief = item.optString("brief").take(220),
                    author = item.optString("author", "AIYA 创作者").take(80),
                    model = item.optString("model").take(200).ifBlank { "AIYA 默认模型" },
                    initialPrompt = item.optString("initialPrompt").take(2_000),
                    html = html.take(MAX_HTML_BYTES),
                    featuredAt = item.optString("featuredAt").take(64),
                    icon = icon,
                ),
            )
        }
    }
}

private fun readJsonResponse(connection: HttpURLConnection): JSONObject {
    val status = connection.responseCode
    val responseText = (if (status in 200..299) connection.inputStream else connection.errorStream)
        ?.bufferedReader(Charsets.UTF_8)
        ?.use { it.readText() }
        ?: ""
    val json = JSONObject(responseText.ifBlank { "{}" })
    if (status !in 200..299 || !json.optBoolean("ok", false)) {
        throw IllegalStateException(json.optString("error", "网络请求失败。").take(220))
    }
    return json
}

private fun downloadBytes(url: String, accept: String): ByteArray {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 15_000
        readTimeout = 300_000
        setRequestProperty("Accept", accept)
    }
    try {
        val status = connection.responseCode
        if (status !in 200..299) {
            val error = connection.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            throw IllegalStateException(error.ifBlank { "文件下载失败：$status" }.take(220))
        }
        return connection.inputStream.use { it.readBytes() }
    } finally {
        connection.disconnect()
    }
}

private class AndroidVoiceInputController(
    private val context: Context,
    private val mainHandler: Handler,
) {
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    private val pendingAudioLock = Any()
    private val pendingAudioChunks = mutableListOf<ByteArray>()
    private var socket: WebSocket? = null
    private var recorder: AudioRecord? = null
    private var recordingThread: Thread? = null
    private var onState: ((VoiceUiState) -> Unit)? = null
    private var onCommit: ((String) -> Unit)? = null
    private var finalText = ""
    private var partialText = ""
    @Volatile private var active = false
    @Volatile private var ready = false
    @Volatile private var commitDone = false
    @Volatile private var stopRequested = false

    fun start(
        onState: (VoiceUiState) -> Unit,
        onCommit: (String) -> Unit,
    ) {
        if (active) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            onState(VoiceUiState(VoiceStatus.Error("\u8bf7\u5148\u5728\u7cfb\u7edf\u5f39\u7a97\u6216\u5e94\u7528\u8bbe\u7f6e\u91cc\u5141\u8bb8\u9ea6\u514b\u98ce\u6743\u9650\u3002")))
            return
        }

        this.onState = onState
        this.onCommit = onCommit
        finalText = ""
        partialText = ""
        active = true
        ready = false
        commitDone = false
        stopRequested = false
        clearPendingAudio()
        postState(VoiceUiState(VoiceStatus.Connecting))

        val requestId = "aiya-v3-${UUID.randomUUID()}"
        val request = Request.Builder()
            .url(ASR_WS_URL)
            .header("Origin", AIYA_ORIGIN)
            .build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val startMessage = JSONObject()
                    .put("type", "start")
                    .put("language", "zh")
                    .put("sampleRate", 16000)
                    .put("format", "pcm_s16le")
                    .put("scene", "chat_input")
                    .put("requestId", requestId)
                    .put("hotwords", JSONArray())
                webSocket.send(startMessage.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleServerMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                fail("\u8bed\u97f3\u8bc6\u522b\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5\u3002")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (active && !commitDone) finishCommit()
            }
        })

        startRecorder()

        mainHandler.postDelayed({
            if (active && !ready && !commitDone) fail("\u8bed\u97f3\u8bc6\u522b\u8fde\u63a5\u8d85\u65f6\uff0c\u8bf7\u91cd\u8bd5\u3002")
        }, 8_000)
    }

    fun stop() {
        if (!active || commitDone) return
        stopRequested = true
        stopRecorder()
        postState(VoiceUiState(VoiceStatus.Transcribing, liveText()))
        if (ready) {
            flushPendingAudio()
            socket?.send(JSONObject().put("type", "stop").toString())
        }
        mainHandler.postDelayed({
            if (active && !commitDone) finishCommit()
        }, 3_500)
    }

    fun cancel() {
        active = false
        ready = false
        stopRequested = false
        clearPendingAudio()
        stopRecorder()
        socket?.send(JSONObject().put("type", "cancel").toString())
        socket?.close(1000, "cancel")
        socket = null
        postState(VoiceUiState())
    }

    private fun handleServerMessage(raw: String) {
        val message = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (message.optString("type")) {
            "ready" -> {
                ready = true
                flushPendingAudio()
                if (stopRequested) {
                    socket?.send(JSONObject().put("type", "stop").toString())
                    postState(VoiceUiState(VoiceStatus.Transcribing, liveText()))
                } else {
                    postState(VoiceUiState(VoiceStatus.Listening, liveText()))
                }
            }
            "partial" -> {
                partialText = message.optString("text", "")
                postState(VoiceUiState(VoiceStatus.Transcribing, liveText()))
            }
            "final" -> {
                finalText += message.optString("text", "")
                partialText = ""
                postState(VoiceUiState(VoiceStatus.Transcribing, liveText()))
            }
            "done" -> finishCommit()
            "error" -> fail(message.optString("message", "\u8bed\u97f3\u8bc6\u522b\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002"))
        }
    }

    @SuppressLint("MissingPermission")
    private fun startRecorder() {
        if (!active) return
        val sampleRate = 16_000
        val minBuffer = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val bufferSize = max(minBuffer, 12_800)
        val audioRecord = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .build()

        if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
            audioRecord.release()
            fail("\u6ca1\u6709\u68c0\u6d4b\u5230\u53ef\u7528\u9ea6\u514b\u98ce\u3002")
            return
        }

        recorder = audioRecord
        runCatching { audioRecord.startRecording() }
            .onFailure {
                audioRecord.release()
                fail("\u9ea6\u514b\u98ce\u5f53\u524d\u4e0d\u53ef\u7528\uff0c\u8bf7\u68c0\u67e5\u6743\u9650\u6216\u662f\u5426\u88ab\u5176\u4ed6\u5e94\u7528\u5360\u7528\u3002")
                return
            }

        postState(VoiceUiState(VoiceStatus.Listening))
        recordingThread = Thread {
            val buffer = ByteArray(6_400)
            while (active && recorder === audioRecord) {
                val count = runCatching { audioRecord.read(buffer, 0, buffer.size) }.getOrDefault(0)
                if (count > 0) {
                    handleAudioChunk(buffer.copyOf(count))
                }
            }
        }.apply {
            name = "aiya-v3-voice-recorder"
            isDaemon = true
            start()
        }
    }

    private fun handleAudioChunk(chunk: ByteArray) {
        if (!active || commitDone || stopRequested) return
        if (ready) {
            flushPendingAudio()
            socket?.send(chunk.toByteString())
            return
        }
        synchronized(pendingAudioLock) {
            pendingAudioChunks.add(chunk)
            while (pendingAudioChunks.size > 24) pendingAudioChunks.removeAt(0)
        }
    }

    private fun flushPendingAudio() {
        val chunks = synchronized(pendingAudioLock) {
            val copy = pendingAudioChunks.toList()
            pendingAudioChunks.clear()
            copy
        }
        chunks.forEach { chunk -> socket?.send(chunk.toByteString()) }
    }

    private fun clearPendingAudio() {
        synchronized(pendingAudioLock) { pendingAudioChunks.clear() }
    }

    private fun stopRecorder() {
        val audioRecord = recorder
        recorder = null
        recordingThread = null
        if (audioRecord != null) {
            runCatching { audioRecord.stop() }
            runCatching { audioRecord.release() }
        }
    }

    private fun finishCommit() {
        if (commitDone) return
        commitDone = true
        stopRecorder()
        val text = liveText()
        active = false
        ready = false
        stopRequested = false
        clearPendingAudio()
        socket?.close(1000, "done")
        socket = null
        mainHandler.post {
            if (text.isNotBlank()) onCommit?.invoke(text)
            onState?.invoke(VoiceUiState(VoiceStatus.Done, text))
            mainHandler.postDelayed({
                onState?.invoke(VoiceUiState())
            }, 1_200)
        }
    }

    private fun fail(message: String) {
        if (commitDone) return
        commitDone = true
        active = false
        ready = false
        stopRequested = false
        clearPendingAudio()
        stopRecorder()
        socket?.close(1001, "error")
        socket = null
        postState(VoiceUiState(VoiceStatus.Error(message.take(80))))
    }

    private fun liveText() = (finalText + partialText).trim()

    private fun postState(state: VoiceUiState) {
        mainHandler.post {
            onState?.invoke(state)
        }
    }
}

private class AndroidTeacherVoiceController(
    private val context: Context,
    private val mainHandler: Handler,
) {
    private var mediaPlayer: MediaPlayer? = null
    private var onState: ((TeacherVoiceUiState) -> Unit)? = null
    @Volatile private var runId = 0

    fun speak(text: String, onState: (TeacherVoiceUiState) -> Unit) {
        val content = text.trim().take(420)
        if (content.isBlank()) return
        this.onState = onState
        val currentRun = ++runId
        stopMediaOnly()
        postState(TeacherVoiceUiState(TeacherVoiceStatus.Loading, "\u6b63\u5728\u4e0b\u8f7d\u8001\u5e08\u8bed\u97f3"))
        Log.i(AIYA_LOG_TAG, "teacher-voice request run=$currentRun textLength=${content.length} mode=v2-stream-download-cache")
        Thread {
            val result = runCatching { downloadTeacherVoiceToCache(content, currentRun) }
            mainHandler.post {
                if (currentRun != runId) return@post
                result
                    .onSuccess { file -> playCachedAudio(file, currentRun) }
                    .onFailure { error -> reportError(currentRun, "\u8001\u5e08\u8bed\u97f3\u4e0b\u8f7d\u5931\u8d25", error) }
            }
        }.apply {
            name = "aiya-v3-teacher-voice-download"
            isDaemon = true
            start()
        }
    }

    fun playBundled(
        rawResourceId: Int,
        description: String,
        onState: (TeacherVoiceUiState) -> Unit,
    ) {
        this.onState = onState
        val currentRun = ++runId
        stopMediaOnly()
        postState(TeacherVoiceUiState(TeacherVoiceStatus.Loading, "正在准备老师讲解"))
        Thread {
            val result = runCatching {
                val file = File(context.cacheDir, "aiya-teacher-fixed-$rawResourceId.mp3")
                context.resources.openRawResource(rawResourceId).use { input ->
                    file.outputStream().use { output -> input.copyTo(output) }
                }
                if (file.length() < 512L) throw IllegalStateException("固定讲解语音文件无效。")
                file
            }
            mainHandler.post {
                if (currentRun != runId) return@post
                result
                    .onSuccess { file ->
                        Log.i(
                            AIYA_LOG_TAG,
                            "teacher-voice bundled ready run=$currentRun bytes=${file.length()} descriptionLength=${description.length}",
                        )
                        playCachedAudio(file, currentRun)
                    }
                    .onFailure { error -> reportError(currentRun, "老师固定讲解语音加载失败", error) }
            }
        }.apply {
            name = "aiya-v3-teacher-fixed-audio"
            isDaemon = true
            start()
        }
    }

    fun stop() {
        runId += 1
        stopMediaOnly()
        postState(TeacherVoiceUiState())
    }

    fun release() {
        stop()
    }

    private fun downloadTeacherVoiceToCache(text: String, currentRun: Int): File {
        val isWelcome = text == TEACHER_WELCOME_TEXT
        val cacheKey = sha256Hex("teacher-voice-v1|$DEFAULT_TEACHER_VOICE|$text").take(40)
        val file = File(context.cacheDir, "aiya-teacher-voice-$cacheKey.mp3")
        if (file.isFile && file.length() >= 512L) {
            file.setLastModified(System.currentTimeMillis())
            Log.i(
                AIYA_LOG_TAG,
                "teacher-voice local-cache-hit run=$currentRun bytes=${file.length()} welcome=$isWelcome",
            )
            return file
        }
        val url = if (isWelcome) {
            TEACHER_WELCOME_AUDIO_URL
        } else {
            "$TEACHER_TTS_STREAM_URL?text=${URLEncoder.encode(text, Charsets.UTF_8.name())}&speaker=$DEFAULT_TEACHER_VOICE"
        }
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Accept", "audio/mpeg,audio/*,application/json;q=0.7")
        }
        try {
            val status = connection.responseCode
            val contentType = connection.contentType.orEmpty()
            val input = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = input?.use { it.readBytes() } ?: ByteArray(0)
            Log.i(AIYA_LOG_TAG, "teacher-voice http run=$currentRun status=$status contentType=$contentType bytes=${bytes.size} welcome=$isWelcome")
            if (status !in 200..299) {
                val errorBody = bytes.toString(Charsets.UTF_8).take(180)
                throw IllegalStateException("HTTP $status $errorBody")
            }
            if (!contentType.contains("audio", ignoreCase = true) && !contentType.contains("mpeg", ignoreCase = true)) {
                val body = bytes.toString(Charsets.UTF_8).take(180)
                throw IllegalStateException("unexpected content-type=$contentType body=$body")
            }
            if (bytes.size < 512) {
                throw IllegalStateException("audio too small: ${bytes.size} bytes")
            }
            val temporary = File(context.cacheDir, "${file.name}.$currentRun.tmp")
            temporary.writeBytes(bytes)
            if (!temporary.renameTo(file)) {
                file.writeBytes(bytes)
                temporary.delete()
            }
            trimTeacherVoiceCache()
            return file
        } finally {
            connection.disconnect()
        }
    }

    private fun trimTeacherVoiceCache(maxFiles: Int = 96) {
        val files = context.cacheDir.listFiles { candidate ->
            candidate.isFile && candidate.name.startsWith("aiya-teacher-voice-") && candidate.extension == "mp3"
        }.orEmpty()
        if (files.size <= maxFiles) return
        files.sortedBy { it.lastModified() }
            .take(files.size - maxFiles)
            .forEach { oldFile -> runCatching { oldFile.delete() } }
    }

    private fun playCachedAudio(file: File, currentRun: Int) {
        if (currentRun != runId) return
        stopMediaOnly()
        val player = MediaPlayer()
        mediaPlayer = player
        try {
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            player.setDataSource(file.absolutePath)
            player.setOnPreparedListener {
                if (currentRun != runId) {
                    it.release()
                    return@setOnPreparedListener
                }
                Log.i(AIYA_LOG_TAG, "teacher-voice prepared-local run=$currentRun file=${file.name} bytes=${file.length()}")
                postState(TeacherVoiceUiState(TeacherVoiceStatus.Speaking, "\u8001\u5e08\u6b63\u5728\u8bb2\u89e3"))
                runCatching { it.start() }
                    .onFailure { error -> reportError(currentRun, "\u8001\u5e08\u8bed\u97f3\u5f00\u59cb\u64ad\u653e\u5931\u8d25", error) }
            }
            player.setOnCompletionListener {
                Log.i(AIYA_LOG_TAG, "teacher-voice completed run=$currentRun")
                if (currentRun == runId) postState(TeacherVoiceUiState())
                stopMediaOnly()
            }
            player.setOnErrorListener { _, what, extra ->
                reportError(currentRun, "\u8001\u5e08\u8bed\u97f3\u64ad\u653e\u5931\u8d25 what=$what extra=$extra", null)
                true
            }
            postState(TeacherVoiceUiState(TeacherVoiceStatus.Loading, "\u6b63\u5728\u51c6\u5907\u64ad\u653e\u8001\u5e08\u8bed\u97f3"))
            player.prepareAsync()
        } catch (error: Throwable) {
            reportError(currentRun, "\u8001\u5e08\u8bed\u97f3\u64ad\u653e\u51c6\u5907\u5931\u8d25", error)
        }
    }

    private fun reportError(currentRun: Int, message: String, error: Throwable?) {
        if (currentRun != runId) return
        val detail = error?.message?.take(160)
        val visibleMessage = if (detail.isNullOrBlank()) message else "$message：$detail"
        Log.e(AIYA_LOG_TAG, "teacher-voice error run=$currentRun message=$visibleMessage", error)
        stopMediaOnly()
        postState(TeacherVoiceUiState(TeacherVoiceStatus.Error(visibleMessage.take(140))))
    }

    private fun stopMediaOnly() {
        val player = mediaPlayer
        mediaPlayer = null
        if (player != null) {
            runCatching { player.setOnPreparedListener(null) }
            runCatching { player.setOnCompletionListener(null) }
            runCatching { player.setOnErrorListener(null) }
            runCatching { if (player.isPlaying) player.stop() }
            runCatching { player.reset() }
            runCatching { player.release() }
        }
    }

    private fun postState(state: TeacherVoiceUiState) {
        mainHandler.post { onState?.invoke(state) }
    }
}

@Composable
private fun TabIcon(tab: AiyaTab, selected: Boolean, isGenerating: Boolean = false) {
    Box(
        modifier = Modifier.size(38.dp),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(tab.iconRes),
            contentDescription = tab.label,
            contentScale = ContentScale.Fit,
            modifier = Modifier.size(if (selected) 38.dp else 32.dp),
        )
        if (isGenerating) {
            Surface(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(17.dp),
                shape = CircleShape,
                color = Color.White,
                shadowElevation = 2.dp,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(12.dp),
                        color = AiyaGreen,
                        strokeWidth = 2.dp,
                    )
                }
            }
        }
    }
}

@Composable
private fun ScreenShell(
    eyebrow: String,
    title: String,
    subtitle: String,
    creatorCredit: String? = null,
    scrollable: Boolean = true,
    compactHeader: Boolean = false,
    onEyebrowHold: (() -> Unit)? = null,
    versionLabel: String? = null,
    onVersionClick: (() -> Unit)? = null,
    headerTrailing: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val currentOnEyebrowHold by rememberUpdatedState(onEyebrowHold)
    val baseModifier = Modifier
        .fillMaxSize()
        .background(
            Brush.verticalGradient(
                colors = listOf(AiyaMist, Color.White, Color(0xFFF8FCFA)),
            )
        )
        .padding(
            horizontal = if (compactHeader) 18.dp else 22.dp,
            vertical = if (compactHeader) 14.dp else 24.dp,
        )
    val modifier = if (scrollable) baseModifier.verticalScroll(rememberScrollState()) else baseModifier
    Column(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = eyebrow,
                color = AiyaGreen,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                modifier = if (onEyebrowHold == null) {
                    Modifier
                } else {
                    Modifier.pointerInput(eyebrow) {
                        detectTapGestures(
                            onPress = {
                                val releasedBeforeThreshold = withTimeoutOrNull(MODEL_SELECTOR_HOLD_MILLIS) {
                                    tryAwaitRelease()
                                }
                                if (releasedBeforeThreshold == null) currentOnEyebrowHold?.invoke()
                            }
                        )
                    }
                },
            )
            if (versionLabel != null && onVersionClick != null) {
                Spacer(modifier = Modifier.width(8.dp))
                Surface(
                    onClick = onVersionClick,
                    shape = RoundedCornerShape(999.dp),
                    color = Color(0xFFE6F9F2),
                ) {
                    Text(
                        text = versionLabel,
                        color = Color(0xFF16856C),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }
            if (headerTrailing != null) {
                Spacer(modifier = Modifier.weight(1f))
                headerTrailing()
            }
        }
        Spacer(modifier = Modifier.height(if (compactHeader) 3.dp else 8.dp))
        Text(
            text = title,
            color = AiyaInk,
            fontSize = if (compactHeader) 22.sp else 34.sp,
            lineHeight = if (compactHeader) 26.sp else 39.sp,
            fontWeight = FontWeight.ExtraBold,
        )
        Spacer(modifier = Modifier.height(if (compactHeader) 4.dp else 10.dp))
        Text(
            text = subtitle,
            color = Color(0xFF5E706A),
            fontSize = if (compactHeader) 13.sp else 16.sp,
            lineHeight = if (compactHeader) 17.sp else 24.sp,
        )
        if (creatorCredit != null) {
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = creatorCredit,
                color = Color(0xFF16856C),
                fontSize = 12.sp,
                lineHeight = 17.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Spacer(modifier = Modifier.height(if (compactHeader) 10.dp else 26.dp))
        content()
    }
}

@Composable
private fun CreateTab(
    idea: String,
    isGenerating: Boolean,
    voiceUiState: VoiceUiState,
    teacherVoiceUiState: TeacherVoiceUiState,
    teacherProfile: TeacherProfile,
    selectedModelMode: GenerationModelMode,
    hasCurrentWork: Boolean,
    currentWorkTitle: String,
    showCreateEntryChoice: Boolean,
    onContinueCurrentWork: () -> Unit,
    onStartNewWork: () -> Unit,
    onIdeaChange: (String) -> Unit,
    onGenerate: () -> Unit,
    onExample: (String) -> Unit,
    onVoiceStart: () -> Unit,
    onVoiceStop: () -> Unit,
    onReplayTeacherVoice: () -> Unit,
    onStopTeacherVoice: () -> Unit,
    onModelModeSelected: (GenerationModelMode) -> Unit,
    onVersionClick: () -> Unit,
    displayName: String,
    onDisplayNameChange: (String) -> Unit,
) {
    val context = LocalContext.current
    val currentView = LocalView.current
    val focusManager = LocalFocusManager.current
    val newWorkRequest = hasCurrentWork && isExplicitNewWorkRequest(idea)
    var showModelSelector by remember { mutableStateOf(false) }
    var showNameEditor by remember { mutableStateOf(false) }
    var showPromptExamples by remember { mutableStateOf(false) }
    var nameDraft by remember(displayName) { mutableStateOf(displayName) }
    fun hideKeyboard() {
        focusManager.clearFocus()
        val inputMethodManager = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        inputMethodManager?.hideSoftInputFromWindow(currentView.windowToken, 0)
    }

    if (showCreateEntryChoice) {
        AlertDialog(
            onDismissRequest = onContinueCurrentWork,
            title = { Text("\u7ee7\u7eed\u4fee\u6539\uff0c\u8fd8\u662f\u65b0\u5efa\uff1f", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "\u5f53\u524d\u9879\u76ee\uff1a${currentWorkTitle.ifBlank { "AIYA \u4f5c\u54c1" }}\n\u9ed8\u8ba4\u7ee7\u7eed\u4fee\u6539\u3002\u4f60\u4e5f\u53ef\u4ee5\u91cd\u5f00\u4e00\u4e2a\u65b0\u9879\u76ee\u3002",
                    color = Color(0xFF5E706A),
                    lineHeight = 22.sp,
                )
            },
            confirmButton = {
                Button(onClick = onContinueCurrentWork) { Text("\u7ee7\u7eed\u4fee\u6539") }
            },
            dismissButton = {
                TextButton(onClick = onStartNewWork) { Text("\u91cd\u5f00\u65b0\u9879\u76ee") }
            },
        )
    }

    if (showModelSelector) {
        AlertDialog(
            onDismissRequest = { showModelSelector = false },
            title = { Text("选择模型", fontWeight = FontWeight.Bold) },
            text = {
                Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    GenerationModelMode.entries.forEach { mode ->
                        val selected = mode == selectedModelMode
                        Surface(
                            onClick = {
                                onModelModeSelected(mode)
                                showModelSelector = false
                            },
                            shape = RoundedCornerShape(18.dp),
                            color = if (selected) Color(0xFFDFFFF3) else Color(0xFFF5F8F7),
                        ) {
                            Column(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(mode.label, modifier = Modifier.weight(1f).padding(end = 8.dp), color = AiyaInk, fontWeight = FontWeight.Bold, fontSize = 18.sp, lineHeight = 26.sp)
                                    if (selected) Text("当前", color = AiyaGreen, fontWeight = FontWeight.Bold)
                                }
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(mode.modelId, color = Color(0xFF52685E), fontSize = 16.sp, lineHeight = 24.sp)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(mode.description, color = Color(0xFF5E706A), fontSize = 16.sp, lineHeight = 24.sp)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showModelSelector = false }) { Text("关闭") }
            },
        )
    }

    if (showNameEditor) {
        AlertDialog(
            onDismissRequest = { showNameEditor = false },
            title = { Text("怎么称呼你？", fontWeight = FontWeight.Bold) },
            text = {
                OutlinedTextField(
                    value = nameDraft,
                    onValueChange = { nameDraft = it.take(16) },
                    singleLine = true,
                    label = { Text("你的名字") },
                    placeholder = { Text("例如：小明") },
                )
            },
            confirmButton = {
                Button(onClick = {
                    onDisplayNameChange(nameDraft)
                    showNameEditor = false
                }) { Text("保存") }
            },
            dismissButton = {
                TextButton(onClick = { showNameEditor = false }) { Text("取消") }
            },
        )
    }

    if (showPromptExamples) {
        GoldenKeyDialog(
            starterExamples = promptExamples,
            hasCurrentWork = hasCurrentWork,
            onChoose = { example ->
                hideKeyboard()
                onExample(example.prompt)
                showPromptExamples = false
                Toast.makeText(context, "已填入「${example.title}」，可修改后确认提交", Toast.LENGTH_SHORT).show()
            },
            onDismiss = { showPromptExamples = false },
        )
    }

        ScreenShell(
        eyebrow = "AIYA",
        title = if (newWorkRequest) "新建一个作品" else if (hasCurrentWork) "继续说想改哪里" else "你想做什么？",
        subtitle = if (newWorkRequest) "这次会新开项目，不覆盖当前作品。" else if (hasCurrentWork) "说一句，AIYA 会在当前作品上继续改。" else "说一句，AIYA 把想法做成可以试玩的作品。",
        creatorCredit = "作者：君维 · 联系微信：16675143990",
        onEyebrowHold = { showModelSelector = true },
        versionLabel = "v${BuildConfig.VERSION_NAME}",
        onVersionClick = onVersionClick,
        headerTrailing = {
            UserNameChip(name = displayName, onClick = {
                nameDraft = displayName
                showNameEditor = true
            })
        },
    ) {
        TeacherVoiceStrip(
            reply = TEACHER_WELCOME_TEXT,
            state = teacherVoiceUiState,
            teacherProfile = teacherProfile,
            onReplay = onReplayTeacherVoice,
            onStop = onStopTeacherVoice,
        )
        Spacer(modifier = Modifier.height(14.dp))
        Text("模型选择", fontSize = 16.sp, color = AiyaInk, fontWeight = FontWeight.SemiBold)
        Spacer(modifier = Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GenerationModelMode.entries.forEach { mode ->
                Surface(
                    onClick = { onModelModeSelected(mode) },
                    enabled = !isGenerating,
                    modifier = Modifier.weight(1f).heightIn(min = 88.dp).fillMaxHeight(),
                    shape = RoundedCornerShape(12.dp),
                    color = if (mode == selectedModelMode) Color(0xFFDFFFF3) else Color(0xFFF0F5F3),
                ) {
                    Box(modifier = Modifier.padding(horizontal = 8.dp, vertical = 12.dp), contentAlignment = Alignment.Center) {
                        Text(mode.label, fontSize = 16.sp, lineHeight = 24.sp, textAlign = TextAlign.Center, color = AiyaInk, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            "当前：${selectedModelMode.label}\n${selectedModelMode.modelId} · 下一次任务生效",
            fontSize = 16.sp, lineHeight = 26.sp, color = Color(0xFF52685E),
        )
        Spacer(modifier = Modifier.height(14.dp))
        OutlinedTextField(
            modifier = Modifier
                .fillMaxWidth()
                .height(156.dp),
            value = idea,
            onValueChange = onIdeaChange,
            enabled = !isGenerating,
            placeholder = { Text("例如：做一个会穿墙的贪吃蛇") },
            trailingIcon = {
                Column(
                    modifier = Modifier.height(124.dp).padding(vertical = 4.dp),
                    verticalArrangement = Arrangement.SpaceBetween,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    if (idea.isNotBlank() && !isGenerating) {
                        TextButton(onClick = { onIdeaChange("") }) {
                            Text("\u6e05\u7a7a", fontWeight = FontWeight.Bold)
                        }
                    } else {
                        Spacer(modifier = Modifier.height(40.dp))
                    }
                    Surface(
                        onClick = {
                            hideKeyboard()
                            onGenerate()
                        },
                        enabled = idea.isNotBlank() && !isGenerating,
                        modifier = Modifier.size(42.dp),
                        shape = CircleShape,
                        color = if (idea.isNotBlank() && !isGenerating) AiyaGreen else Color(0xFFDCE7E3),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Image(
                                painter = painterResource(R.drawable.aiya_icon_enter),
                                contentDescription = "提交创作",
                                modifier = Modifier.size(24.dp),
                            )
                        }
                    }
                }
            },
            shape = RoundedCornerShape(28.dp),
            maxLines = 5,
            keyboardOptions = KeyboardOptions.Default.copy(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(
                onDone = {
                    hideKeyboard()
                    onGenerate()
                },
            ),
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "收起软键盘：按手机返回键，或点右侧按钮。",
                color = Color(0xFF7D8B86),
                fontSize = 12.sp,
                lineHeight = 17.sp,
                modifier = Modifier.weight(1f),
            )
            TextButton(
                enabled = !isGenerating,
                onClick = { hideKeyboard() },
            ) {
                Text("收起键盘", fontWeight = FontWeight.Bold)
            }
        }
        Spacer(modifier = Modifier.height(12.dp))
        PromptExamplesButton(
            enabled = !isGenerating,
            onClick = {
                hideKeyboard()
                showPromptExamples = true
            },
        )
        Spacer(modifier = Modifier.height(18.dp))
        VoiceInputPad(
            state = voiceUiState,
            enabled = !isGenerating,
            onStart = {
                hideKeyboard()
                onVoiceStart()
            },
            onStop = onVoiceStop,
        )
        Spacer(modifier = Modifier.height(18.dp))
        Text(
            text = "输入文字后点击软键盘的“完成”即可提交；按住说话，松开后会直接提交。",
            color = Color(0xFF72827C),
            fontSize = 13.sp,
            lineHeight = 19.sp,
        )
    }
}

@Composable
private fun UserNameChip(name: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        color = Color.White,
        shadowElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(18.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFD9FFF0)),
                contentAlignment = Alignment.Center,
            ) {
                Text(name.take(1), color = AiyaGreen, fontSize = 10.sp, fontWeight = FontWeight.ExtraBold)
            }
            Spacer(modifier = Modifier.width(5.dp))
            Text(name, color = AiyaInk, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        }
    }
}

@Composable
private fun VoiceInputPad(
    state: VoiceUiState,
    enabled: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
) {
    val active = state.isActive
    val currentOnStart by rememberUpdatedState(onStart)
    val currentOnStop by rememberUpdatedState(onStop)
    val background = when {
        !enabled -> Color(0xFFF2F5F4)
        active -> AiyaGreen
        state.status is VoiceStatus.Error -> Color(0xFFFFF2EF)
        else -> Color.White
    }
    val foreground = when {
        active -> Color.White
        state.status is VoiceStatus.Error -> Color(0xFF9F3F31)
        else -> AiyaInk
    }
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .height(74.dp)
            .pointerInput(enabled) {
                detectTapGestures(
                    onPress = {
                        if (!enabled) return@detectTapGestures
                        currentOnStart()
                        try {
                            tryAwaitRelease()
                        } finally {
                            currentOnStop()
                        }
                    }
                )
            },
        shape = RoundedCornerShape(24.dp),
        color = background,
        shadowElevation = if (enabled && !active) 2.dp else 0.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(
                painter = painterResource(R.drawable.aiya_icon_microphone),
                contentDescription = "麦克风",
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(50.dp),
            )
            Spacer(modifier = Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(state.label, color = foreground, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    state.message,
                    color = if (active) Color.White.copy(alpha = 0.82f) else Color(0xFF72827C),
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    maxLines = 2,
                )
            }
        }
    }
}

@Composable
private fun PromptExamplesButton(enabled: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        color = if (enabled) Color(0xFFE9FBF4) else Color(0xFFF2F5F4),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (enabled) Color.White else Color(0xFFE6EBE9)),
                contentAlignment = Alignment.Center,
            ) {
                Text("钥", color = AiyaGreen, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("金钥匙", color = AiyaInk, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    "进阶样板 · 也可选择入门示例",
                    color = Color(0xFF65756F),
                    fontSize = 18.sp,
                    lineHeight = 30.sp,
                )
            }
            Text("选择 ›", color = AiyaGreen, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun PlayTab(
    work: GeneratedWork?,
    workLibrary: List<GeneratedWork>,
    generationState: GenerationState,
    onCancelGeneration: () -> Unit,
    onBackToCreate: () -> Unit,
    onSelectWork: (GeneratedWork) -> Unit,
    canRollback: Boolean,
    onRollback: () -> Unit,
    onRecover: () -> Unit,
    onRetry: (String) -> Unit,
) {
    when (generationState) {
        is GenerationState.Loading -> LoadingPlayTab(
            loading = generationState,
            onCancelGeneration = onCancelGeneration,
        )
        is GenerationState.Failed -> FailedPlayTab(generationState, onBackToCreate, onRetry, onRecover)
        else -> WorkPlayTab(
            work = work,
            workLibrary = workLibrary,
            onBackToCreate = onBackToCreate,
            onSelectWork = onSelectWork,
            canRollback = canRollback,
            onRollback = onRollback,
        )
    }
}

@Composable
private fun LoadingPlayTab(
    loading: GenerationState.Loading,
    onCancelGeneration: () -> Unit,
) {
    var elapsedSeconds by remember(loading.generationId) { mutableStateOf(0L) }
    var showTrace by remember { mutableStateOf(false) }
    LaunchedEffect(loading.generationId, loading.startedAt) {
        while (true) {
            elapsedSeconds = ((System.currentTimeMillis() - loading.startedAt) / 1000).coerceAtLeast(0)
            delay(1000)
        }
    }
    if (showTrace) GenerationTraceDialog(loading.buildExecutionJson) { showTrace = false }
    ScreenShell(
        eyebrow = "试玩",
        title = "AIYA 正在制作",
        subtitle = "不想等了可以撤销，回到输入框继续改。",
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 360.dp)
                .clip(RoundedCornerShape(32.dp))
                .background(
                    Brush.verticalGradient(
                        colors = listOf(Color(0xFFEFFFF9), Color.White),
                    ),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Column(modifier = Modifier.padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .clip(CircleShape)
                        .background(Color(0xFFD9FFF0)),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = AiyaGreen, strokeWidth = 4.dp)
                }
                Spacer(modifier = Modifier.height(18.dp))
                Text("老师正在制作", color = AiyaInk, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "已等待 ${elapsedSeconds} 秒 · ${loading.message}",
                    fontSize = 18.sp, lineHeight = 30.sp,
                    color = Color(0xFF5E706A),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
                Spacer(modifier = Modifier.height(14.dp))
                Surface(
                    modifier = Modifier.padding(horizontal = 24.dp),
                    shape = RoundedCornerShape(16.dp),
                    color = Color.White.copy(alpha = 0.86f),
                ) {
                    Text(
                        text = loading.idea,
                        fontSize = 18.sp, lineHeight = 30.sp,
                        color = Color(0xFF3B6D62),
                        textAlign = TextAlign.Center,
                        maxLines = 3,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                    )
                }
            }
        }
        TextButton(onClick = { showTrace = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("查看任务轨迹", fontSize = 16.sp, color = AiyaGreen)
        }
        Spacer(modifier = Modifier.height(18.dp))
        Button(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            shape = RoundedCornerShape(999.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Color(0xFFD9FFF0),
                contentColor = Color(0xFF0F6F58),
            ),
            onClick = onCancelGeneration,
        ) {
            Text("撤销生成，回到创作", fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(modifier = Modifier.height(10.dp))
        Text(
            text = "撤销后，后台迟到的生成结果不会覆盖当前作品。",
            color = Color(0xFF72827C),
            fontSize = 18.sp,
            lineHeight = 30.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun FailedPlayTab(
    failed: GenerationState.Failed,
    onBackToCreate: () -> Unit,
    onRetry: (String) -> Unit,
    onRecover: () -> Unit,
) {
    val recoverable = failed.recoveryTaskId.isNotBlank()
    var showTrace by remember { mutableStateOf(false) }
    if (showTrace) GenerationTraceDialog(failed.buildExecutionJson) { showTrace = false }
    ScreenShell(
        eyebrow = "试玩",
        title = if (recoverable) "结果尚未取回" else "这次没做好",
        subtitle = if (recoverable) "原任务可能已经完成。恢复只查询结果，不重复生成。" else "可以直接重试，也可以回到创作页换个说法。",
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(28.dp),
            color = Color.White,
            shadowElevation = 2.dp,
        ) {
            Text(
                text = failed.message,
                modifier = Modifier.padding(20.dp),
                color = Color(0xFF5E332E),
                fontSize = 18.sp,
                lineHeight = 30.sp,
            )
        }
        TextButton(onClick = { showTrace = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("查看任务轨迹", fontSize = 16.sp, color = AiyaGreen)
        }
        Spacer(modifier = Modifier.height(22.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                modifier = Modifier.weight(1f).height(56.dp),
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AiyaGreen),
                onClick = { if (recoverable) onRecover() else onRetry(failed.lastIdea) },
            ) { Text(if (recoverable) "恢复原任务" else "再试一次", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
            Button(
                modifier = Modifier.weight(1f).height(56.dp),
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F2A23)),
                onClick = onBackToCreate,
            ) { Text("换个说法", fontSize = 16.sp, fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun WorkPlayTab(
    work: GeneratedWork?,
    workLibrary: List<GeneratedWork>,
    onBackToCreate: () -> Unit,
    onSelectWork: (GeneratedWork) -> Unit,
    canRollback: Boolean,
    onRollback: () -> Unit,
) {
    if (work == null) {
        ScreenShell(
            eyebrow = "试玩",
            title = "先创作，再试玩",
            subtitle = "这里会出现 AIYA 生成的作品。",
        ) {
            if (workLibrary.isNotEmpty()) {
                Text(
                    text = "也可以切回本机已有作品继续开发：",
                    color = Color(0xFF5E706A),
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                )
                Spacer(modifier = Modifier.height(10.dp))
                WorkSwitcherRow(
                    works = workLibrary,
                    currentWorkId = "",
                    onSelectWork = onSelectWork,
                )
                Spacer(modifier = Modifier.height(22.dp))
            }
            EmptyPlayBox()
            Spacer(modifier = Modifier.height(22.dp))
            Button(
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AiyaGreen),
                onClick = onBackToCreate,
            ) { Text("去创作", fontWeight = FontWeight.Bold) }
        }
        return
    }

    var showTrace by remember(work.id, work.buildExecutionJson) { mutableStateOf(false) }
    if (showTrace) GenerationTraceDialog(work.buildExecutionJson) { showTrace = false }
    Column(
        modifier = Modifier.fillMaxSize().background(Color.White),
    ) {
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.End) {
            if (canRollback) TextButton(onClick = onRollback, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("回退上一版", fontSize = 16.sp, color = AiyaGreen)
            }
            TextButton(onClick = { showTrace = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text("任务轨迹", fontSize = 16.sp, color = AiyaGreen)
            }
        }
        if (workLibrary.size > 1) {
            WorkSwitcherRow(
                works = workLibrary,
                currentWorkId = work.id,
                onSelectWork = onSelectWork,
            )
        }
        GeneratedWorkWebView(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f),
            title = work.title,
            html = work.html,
        )
    }
}

@Composable
private fun WorkSwitcherRow(
    works: List<GeneratedWork>,
    currentWorkId: String,
    onSelectWork: (GeneratedWork) -> Unit,
    onLongPress: ((GeneratedWork) -> Unit)? = null,
    compact: Boolean = false,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFFF8FCFA),
        shadowElevation = 1.dp,
    ) {
        LazyRow(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = if (compact) 8.dp else 10.dp, vertical = if (compact) 4.dp else 7.dp),
            horizontalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 8.dp),
        ) {
            items(works) { item ->
                val selected = item.id == currentWorkId
                WorkSwitchChip(
                    work = item,
                    selected = selected,
                    onClick = { if (!selected) onSelectWork(item) },
                    onLongPress = onLongPress?.let { callback -> { callback(item) } },
                    compact = compact,
                )
            }
        }
    }
}

@Composable
private fun WorkSwitchChip(
    work: GeneratedWork,
    selected: Boolean,
    onClick: () -> Unit,
    onLongPress: (() -> Unit)? = null,
    compact: Boolean = false,
) {
    var isHolding by remember(work.id) { mutableStateOf(false) }
    var deletionTriggered by remember(work.id) { mutableStateOf(false) }
    val deleteProgress = remember(work.id) { Animatable(0f) }
    val currentOnClick by rememberUpdatedState(onClick)
    val currentOnLongPress by rememberUpdatedState(onLongPress)
    val supportsDelete = onLongPress != null

    LaunchedEffect(isHolding, supportsDelete, work.id) {
        if (!isHolding || !supportsDelete) {
            deleteProgress.snapTo(0f)
            return@LaunchedEffect
        }
        deleteProgress.snapTo(0f)
        deleteProgress.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = DELETE_HOLD_MILLIS, easing = LinearEasing),
        )
        if (isHolding && !deletionTriggered) {
            deletionTriggered = true
            currentOnLongPress?.invoke()
        }
    }

    val interactionModifier = if (!supportsDelete) {
        Modifier.clickable(enabled = !selected, onClick = onClick)
    } else {
        Modifier.pointerInput(work.id, selected) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                val touchSlop = viewConfiguration.touchSlop * 1.5f
                var moved = false
                deletionTriggered = false
                isHolding = true
                while (true) {
                    val event = awaitPointerEvent(PointerEventPass.Initial)
                    val pointer = event.changes.firstOrNull { it.id == down.id }
                    if (pointer == null || !pointer.pressed) break
                    val distance = hypot(
                        pointer.position.x - down.position.x,
                        pointer.position.y - down.position.y,
                    )
                    if (distance > touchSlop) {
                        moved = true
                        isHolding = false
                    }
                }
                val shouldSelect = !moved && !deletionTriggered && !selected
                isHolding = false
                if (shouldSelect) currentOnClick()
            }
        }
    }
    Surface(
        modifier = Modifier
            .height(if (compact) 32.dp else 34.dp)
            .widthIn(min = if (compact) 68.dp else 74.dp, max = 156.dp)
            .clip(RoundedCornerShape(999.dp))
            .then(interactionModifier),
        shape = RoundedCornerShape(999.dp),
        color = when {
            isHolding -> Color(0xFFFFE4DC)
            selected -> AiyaGreen
            else -> Color.White
        },
        shadowElevation = if (selected) 0.dp else 1.dp,
    ) {
        Box(
            modifier = Modifier.padding(horizontal = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = if (isHolding) "松手取消" else work.title.ifBlank { "AIYA 作品" },
                color = when {
                    isHolding -> Color(0xFFC74731)
                    selected -> Color.White
                    else -> AiyaInk
                },
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
            if (isHolding) {
                LinearProgressIndicator(
                    progress = { deleteProgress.value },
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .height(3.dp),
                    color = Color(0xFFD7472F),
                    trackColor = Color(0xFFFFF1EC),
                )
            }
        }
    }
}

@Composable
private fun TeacherVoiceStrip(
    reply: String,
    state: TeacherVoiceUiState,
    teacherProfile: TeacherProfile,
    onReplay: () -> Unit,
    onStop: () -> Unit,
) {
    val content = reply.trim().ifBlank { "\u4f5c\u54c1\u505a\u597d\u4e86\uff0c\u53ef\u4ee5\u8bd5\u73a9\u3002" }
    val profile = normalizeTeacherProfile(teacherProfile)
    val statusText = state.message.ifBlank {
        when (state.status) {
            TeacherVoiceStatus.Idle -> "${profile.name}语音"
            TeacherVoiceStatus.Loading -> "正在连接${profile.name}"
            TeacherVoiceStatus.Speaking -> "${profile.name}正在说"
            is TeacherVoiceStatus.Error -> state.label
        }
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        color = Color.White,
        shadowElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(
                painter = painterResource(R.drawable.aiya_icon_teacher),
                contentDescription = "${profile.name}头像",
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(42.dp),
            )
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = statusText,
                    color = if (state.status is TeacherVoiceStatus.Error) Color(0xFF9F3F31) else AiyaInk,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                )
                Text(
                    text = content,
                    color = Color(0xFF72827C),
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                    maxLines = 1,
                )
            }
            TextButton(onClick = if (state.isActive) onStop else onReplay) {
                Text(if (state.isActive) "\u505c\u6b62" else "\u91cd\u64ad", fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun EmptyPlayBox() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(360.dp)
            .clip(RoundedCornerShape(32.dp))
            .background(
                Brush.verticalGradient(
                    colors = listOf(Color(0xFFEFFFF9), Color.White),
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("等待作品", color = AiyaInk, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.height(8.dp))
            Text("去创作页说一个想法", color = Color(0xFF5E706A), textAlign = TextAlign.Center)
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun GeneratedWorkWebView(
    modifier: Modifier = Modifier.fillMaxSize(),
    title: String,
    html: String,
) {
    val preview = remember(html) { prepareGeneratedPreview(html, ::prepareGeneratedHtmlForWebView) }
    val preparedHtml = preview.getOrNull()
    if (preparedHtml == null) {
        Column(
            modifier = modifier.background(Color.White).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("这个作品暂时无法试玩", color = AiyaInk, fontSize = 22.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold)
            Text(preview.exceptionOrNull()?.message ?: "作品加载失败，请返回创作页修改。", color = Color(0xFF7D3535), fontSize = 18.sp, lineHeight = 32.sp)
            Text("作品已保留。可以切换其他项目，或点击左下角「创作」继续修改。", color = Color(0xFF52685E), fontSize = 18.sp, lineHeight = 32.sp)
        }
        return
    }
    val context = LocalContext.current
    var pendingWebPermissionRequest by remember { mutableStateOf<PendingGeneratedPermissionRequest?>(null) }
    val mediaPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        val pending = pendingWebPermissionRequest
        pendingWebPermissionRequest = null
        if (pending != null) {
            val grantedResources = pending.resources.filter { resource ->
                val androidPermission = when (resource) {
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                    else -> return@filter false
                }
                ContextCompat.checkSelfPermission(context, androidPermission) == PackageManager.PERMISSION_GRANTED
            }
            if (grantedResources.isNotEmpty()) pending.request.grant(grantedResources.toTypedArray())
            else pending.request.deny()
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { viewContext ->
            val bridge = AppInteractionBridge(viewContext.applicationContext, title, html)
            WebView(viewContext).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                setBackgroundColor(android.graphics.Color.WHITE)
                overScrollMode = View.OVER_SCROLL_NEVER
                isHorizontalScrollBarEnabled = false
                isVerticalScrollBarEnabled = false
                isFocusable = true
                isFocusableInTouchMode = true
                // Generated apps can still receive touch/pointer events for their
                // own long-press logic, while Android's WebView text-selection
                // toolbar is disabled below.
                isLongClickable = false
                setOnLongClickListener { true }
                addJavascriptInterface(bridge, "AiyaAppInteraction")
                addJavascriptInterface(bridge, "AiyaBodyVision")
                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                        bridge.recordNativeConsole(consoleMessage)
                        return super.onConsoleMessage(consoleMessage)
                    }

                    override fun onPermissionRequest(request: PermissionRequest?) {
                        if (request == null) return
                        post {
                            val origin = request.origin
                            val isTrustedGeneratedOrigin = origin?.scheme.equals("https", ignoreCase = true) &&
                                origin?.host.equals("aiya.shenliu.cc", ignoreCase = true)
                            val supportedResources = request.resources.orEmpty()
                                .filter {
                                    it == PermissionRequest.RESOURCE_AUDIO_CAPTURE ||
                                        it == PermissionRequest.RESOURCE_VIDEO_CAPTURE
                                }
                                .distinct()
                            if (!isTrustedGeneratedOrigin || supportedResources.isEmpty()) {
                                request.deny()
                                return@post
                            }
                            val missingAndroidPermissions = supportedResources.mapNotNull { resource ->
                                when (resource) {
                                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                                    else -> null
                                }
                            }.filter { permission ->
                                ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED
                            }.distinct()
                            if (missingAndroidPermissions.isEmpty()) {
                                request.grant(supportedResources.toTypedArray())
                                return@post
                            }
                            if (pendingWebPermissionRequest != null) {
                                request.deny()
                                return@post
                            }
                            pendingWebPermissionRequest = PendingGeneratedPermissionRequest(request, supportedResources)
                            mediaPermissionLauncher.launch(missingAndroidPermissions.toTypedArray())
                        }
                    }

                    override fun onPermissionRequestCanceled(request: PermissionRequest?) {
                        if (request != null && pendingWebPermissionRequest?.request === request) {
                            pendingWebPermissionRequest = null
                        }
                        super.onPermissionRequestCanceled(request)
                    }
                }
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = true
                }
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = false
                settings.cacheMode = WebSettings.LOAD_NO_CACHE
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.loadWithOverviewMode = false
                settings.useWideViewPort = true
                settings.setSupportZoom(false)
                settings.builtInZoomControls = false
                settings.displayZoomControls = false
                settings.mediaPlaybackRequiresUserGesture = false
                tag = WebViewRuntimeState(htmlHash = "", bridge = bridge)
            }
        },
        update = { webView ->
            val hash = sha256Hex(html)
            val state = webView.tag as? WebViewRuntimeState
            val bridge = state?.bridge ?: AppInteractionBridge(webView.context.applicationContext, title, html).also {
                webView.addJavascriptInterface(it, "AiyaAppInteraction")
                webView.addJavascriptInterface(it, "AiyaBodyVision")
            }
            bridge.updateWork(title, html)
            if (state?.htmlHash != hash) {
                webView.tag = WebViewRuntimeState(htmlHash = hash, bridge = bridge)
                bridge.recordNativeEvent("webview-load-start", JSONObject().put("htmlLength", html.length))
                webView.loadDataWithBaseURL("https://aiya.shenliu.cc/generated/", preparedHtml, "text/html", "UTF-8", null)
            }
        },
        onRelease = { webView ->
            pendingWebPermissionRequest?.request?.deny()
            pendingWebPermissionRequest = null
            (webView.tag as? WebViewRuntimeState)?.bridge?.release()
            webView.removeJavascriptInterface("AiyaAppInteraction")
            webView.removeJavascriptInterface("AiyaBodyVision")
            webView.stopLoading()
            webView.destroy()
        },
    )
}

private data class WebViewRuntimeState(
    val htmlHash: String,
    val bridge: AppInteractionBridge,
)

private data class PendingGeneratedPermissionRequest(
    val request: PermissionRequest,
    val resources: List<String>,
)

private fun prepareGeneratedHtmlForWebView(source: String): String {
    val viewportMeta = "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover\">"
    val fitStyle = """
<style id="aiya-v3-mobile-webview-fit">
  html, body {
    width: 100%;
    min-height: 100%;
    margin: 0;
    overscroll-behavior: none;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  html, body, button, [role="button"], a, label, canvas, svg, img, [data-action], [data-key], [data-value], [data-dir] {
    -webkit-user-select: none !important;
    user-select: none !important;
    -webkit-touch-callout: none !important;
  }
  input, textarea, [contenteditable="true"] {
    -webkit-user-select: text !important;
    user-select: text !important;
    -webkit-touch-callout: default !important;
  }
  img, canvas, svg, video {
    max-width: 100%;
  }
</style>
""".trimIndent()
    val recorderScript = appInteractionRecorderScript()
    val speechBridgeScript = aiyaSpeechBridgeScript()
    val bodyRuntimeScript = aiyaBodyRuntimeScript()
    val touchGuardScript = appTouchGuardScript()

    var html = source
    if (!Regex("<meta\\s+[^>]*name=[\"']viewport[\"'][^>]*>", RegexOption.IGNORE_CASE).containsMatchIn(html)) {
        html = injectIntoHead(html, viewportMeta)
    }
    if (!html.contains("aiya-v3-mobile-webview-fit")) {
        html = injectIntoHead(html, fitStyle)
    }
    if (!html.contains("aiya-v3-app-interaction-recorder")) {
        html = injectIntoHead(html, recorderScript)
    }
    if (!html.contains("aiya-v3-speech-bridge")) {
        html = injectIntoHead(html, speechBridgeScript)
    }
    if (!html.contains("aiya-v3-body-runtime")) {
        html = injectIntoHead(html, bodyRuntimeScript)
    }
    if (!html.contains("aiya-v3-touch-guard")) {
        html = injectIntoHead(html, touchGuardScript)
    }
    return html
}

private fun injectIntoHead(html: String, snippet: String): String {
    val headClose = Regex("</head>", RegexOption.IGNORE_CASE)
    if (headClose.containsMatchIn(html)) {
        return html.replaceFirst(headClose, "$snippet\n</head>")
    }
    val htmlOpen = Regex("<html[^>]*>", RegexOption.IGNORE_CASE)
    val match = htmlOpen.find(html)
    if (match != null) {
        val insertAt = match.range.last + 1
        return html.substring(0, insertAt) + "\n<head>\n$snippet\n</head>" + html.substring(insertAt)
    }
    return "$snippet\n$html"
}

private fun appTouchGuardScript(): String = """
<script id="aiya-v3-touch-guard">
(function () {
  if (window.__AIYA_V3_TOUCH_GUARD_INSTALLED__) return;
  window.__AIYA_V3_TOUCH_GUARD_INSTALLED__ = true;
  var interactive = 'button,[role="button"],a,label,canvas,svg,img,[data-action],[data-key],[data-value],[data-dir]';
  function isInteractive(target) {
    try { return !!(target && target.closest && target.closest(interactive)); } catch (e) { return false; }
  }
  document.addEventListener('contextmenu', function (event) {
    if (isInteractive(event.target)) event.preventDefault();
  }, true);
  document.addEventListener('selectstart', function (event) {
    if (isInteractive(event.target)) event.preventDefault();
  }, true);
  document.addEventListener('dragstart', function (event) {
    if (isInteractive(event.target)) event.preventDefault();
  }, true);
})();
</script>
""".trimIndent()

private fun aiyaSpeechBridgeScript(): String = """
<script id="aiya-v3-speech-bridge">
(function () {
  if (window.__AIYA_V3_SPEECH_BRIDGE_INSTALLED__) return;
  window.__AIYA_V3_SPEECH_BRIDGE_INSTALLED__ = true;
  var nativeBridge = window.AiyaAppInteraction;
  if (!nativeBridge || typeof nativeBridge.speak !== 'function') return;
  function AiyaSpeechUtterance(text) {
    this.text = String(text == null ? '' : text);
    this.lang = 'zh-CN';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
  }
  var nativeSpeech = {
    speaking: false,
    pending: false,
    paused: false,
    speak: function (utterance) {
      var text = utterance && typeof utterance.text !== 'undefined' ? utterance.text : utterance;
      nativeBridge.speak(String(text == null ? '' : text));
    },
    cancel: function () { nativeBridge.stopSpeech(); },
    pause: function () {},
    resume: function () {},
    getVoices: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {}
  };
  try {
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: AiyaSpeechUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: nativeSpeech });
  } catch (error) {
    window.SpeechSynthesisUtterance = AiyaSpeechUtterance;
    window.speechSynthesis = nativeSpeech;
  }
})();
</script>
""".trimIndent()

private fun aiyaBodyRuntimeScript(): String = """
<script id="aiya-v3-body-runtime">
(function () {
  if (window.__AIYA_V3_BODY_RUNTIME_INSTALLED__) return;
  window.__AIYA_V3_BODY_RUNTIME_INSTALLED__ = true;

  function parseJson(value) {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(String(value || '')); }
    catch (error) { return { ok: false, error: 'invalid_native_result', message: String(error && error.message || error) }; }
  }
  function visionBridge() {
    var bridge = window.AiyaBodyVision || window.AiyaAppInteraction;
    return bridge && typeof bridge.capabilities === 'function' ? bridge : null;
  }
  var frameCanvas = document.createElement('canvas');
  var frameContext = frameCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
  function captureFrame(video, maxEdge, quality) {
    if (!video || !video.videoWidth || !video.videoHeight) throw new Error('camera_not_ready');
    var edge = Math.max(160, Math.min(384, Number(maxEdge) || 320));
    var scale = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight));
    frameCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    frameCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
    return frameCanvas.toDataURL('image/jpeg', Math.max(0.45, Math.min(0.82, Number(quality) || 0.68)));
  }
  function analyze(method, input, options) {
    var bridge = visionBridge();
    if (!bridge || typeof bridge[method] !== 'function') return { ok: false, error: 'vision_unavailable', message: '当前容器不支持体感视觉识别' };
    var frame = typeof input === 'string' ? input : captureFrame(input, options && options.maxEdge, options && options.quality);
    return parseJson(bridge[method](frame));
  }

  window.AiyaBodyVisionRuntime = {
    version: 2,
    capabilities: function () {
      var bridge = visionBridge();
      return bridge ? parseJson(bridge.capabilities()) : { ok: false, face: false, gesture: false, error: 'vision_unavailable' };
    },
    captureFrame: captureFrame,
    analyzeFace: function (input, options) { return analyze('analyzeFace', input, options || {}); },
    analyzeGesture: function (input, options) { return analyze('analyzeGesture', input, options || {}); },
    start: function (options) {
      options = options || {};
      var video = options.video;
      var mode = options.mode === 'gesture' || options.mode === 'both' ? options.mode : 'face';
      var fps = Math.max(1, Math.min(8, Number(options.fps) || 5));
      var stopped = false;
      var timer = 0;
      function next(delay) { if (!stopped) timer = setTimeout(loop, Math.max(0, delay)); }
      function loop() {
        if (stopped) return;
        var started = Date.now();
        try {
          var frame = captureFrame(video, options.maxEdge, options.quality);
          var result = mode === 'face'
            ? analyze('analyzeFace', frame, options)
            : mode === 'gesture'
              ? analyze('analyzeGesture', frame, options)
              : { ok: true, face: analyze('analyzeFace', frame, options), gesture: analyze('analyzeGesture', frame, options) };
          if (typeof options.onResult === 'function') options.onResult(result);
        } catch (error) {
          if (typeof options.onError === 'function') options.onError(error);
        }
        next(1000 / fps - (Date.now() - started));
      }
      next(0);
      return { stop: function () { stopped = true; clearTimeout(timer); } };
    }
  };

  function estimatePitch(buffer, sampleRate, options) {
    options = options || {};
    var minHz = Math.max(50, Number(options.minHz) || 80);
    var maxHz = Math.min(sampleRate / 2, Number(options.maxHz) || 4000);
    var rmsSum = 0;
    for (var i = 0; i < buffer.length; i += 1) rmsSum += buffer[i] * buffer[i];
    var rms = Math.sqrt(rmsSum / Math.max(1, buffer.length));
    if (rms < (Number(options.minRms) || 0.008)) return { frequency: 0, clarity: 0, rms: rms, isWhistle: false };
    var minLag = Math.max(2, Math.floor(sampleRate / maxHz));
    var maxLag = Math.min(buffer.length - 2, Math.ceil(sampleRate / minHz));
    var bestLag = 0;
    var best = -1;
    var previousScore = -1;
    var bestPrevious = -1;
    var bestNext = -1;
    for (var lag = minLag; lag <= maxLag; lag += 1) {
      var cross = 0, left = 0, right = 0;
      var limit = buffer.length - lag;
      for (var j = 0; j < limit; j += 1) {
        var a = buffer[j], b = buffer[j + lag];
        cross += a * b; left += a * a; right += b * b;
      }
      var score = cross / Math.sqrt(Math.max(1e-12, left * right));
      if (score > best) { bestPrevious = lag > minLag ? previousScore : score; best = score; bestLag = lag; bestNext = -1; }
      else if (lag === bestLag + 1) bestNext = score;
      previousScore = score;
    }
    var refinedLag = bestLag;
    if (bestLag > 0 && bestNext >= 0 && bestPrevious >= 0) {
      var denom = 2 * (2 * best - bestPrevious - bestNext);
      if (Math.abs(denom) > 1e-6) refinedLag += (bestNext - bestPrevious) / denom;
    }
    var frequency = refinedLag > 0 ? sampleRate / refinedLag : 0;
    var whistleMinHz = Number(options.whistleMinHz) || 700;
    var whistleMaxHz = Number(options.whistleMaxHz) || 4000;
    var clarity = Math.max(0, Math.min(1, best));
    return {
      frequency: Math.round(frequency * 10) / 10,
      clarity: Math.round(clarity * 1000) / 1000,
      rms: Math.round(rms * 10000) / 10000,
      isWhistle: frequency >= whistleMinHz && frequency <= whistleMaxHz && clarity >= (Number(options.whistleClarity) || 0.62)
    };
  }
  window.AiyaBodyAudio = {
    version: 1,
    estimatePitch: estimatePitch,
    createPitchTracker: async function (stream, options) {
      options = options || {};
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) throw new Error('audio_context_unavailable');
      var context = new AudioCtor();
      if (context.state === 'suspended') await context.resume();
      var source = context.createMediaStreamSource(stream);
      var analyser = context.createAnalyser();
      analyser.fftSize = Math.max(1024, Math.min(8192, Number(options.fftSize) || 4096));
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      var buffer = new Float32Array(analyser.fftSize);
      return {
        sample: function () {
          analyser.getFloatTimeDomainData(buffer);
          return estimatePitch(buffer, context.sampleRate, options);
        },
        stop: async function () {
          try { source.disconnect(); } catch (error) {}
          try { analyser.disconnect(); } catch (error) {}
          if (options.closeContext !== false) try { await context.close(); } catch (error) {}
        },
        sampleRate: context.sampleRate
      };
    }
  };

  var motionState = { alpha: 0, beta: 0, gamma: 0, tiltX: 0, tiltY: 0, turn: 0, acceleration: 0, shake: false, action: 'steady' };
  var motionBase = { alpha: 0, beta: 0, gamma: 0 };
  var motionListeners = [];
  var motionStarted = false;
  var motionFrame = 0;
  function normalizedAngle(value) { while (value > 180) value -= 360; while (value < -180) value += 360; return value; }
  function motionAction(state) {
    if (state.shake) return 'shake';
    if (state.tiltX < -18) return 'tilt-left';
    if (state.tiltX > 18) return 'tilt-right';
    if (state.tiltY < -18) return 'tilt-forward';
    if (state.tiltY > 18) return 'tilt-back';
    return 'steady';
  }
  function emitMotion() {
    if (motionFrame) return;
    motionFrame = requestAnimationFrame(function () {
      motionFrame = 0;
      motionState.action = motionAction(motionState);
      var snapshot = Object.assign({}, motionState);
      motionListeners.slice().forEach(function (listener) { try { listener(snapshot); } catch (error) {} });
    });
  }
  function onOrientation(event) {
    motionState.alpha = Number(event.alpha) || 0;
    motionState.beta = Number(event.beta) || 0;
    motionState.gamma = Number(event.gamma) || 0;
    motionState.turn = normalizedAngle(motionState.alpha - motionBase.alpha);
    motionState.tiltY = motionState.beta - motionBase.beta;
    motionState.tiltX = motionState.gamma - motionBase.gamma;
    emitMotion();
  }
  function onDeviceMotion(event) {
    var a = event.acceleration || event.accelerationIncludingGravity || {};
    var x = Number(a.x) || 0, y = Number(a.y) || 0, z = Number(a.z) || 0;
    motionState.acceleration = Math.sqrt(x * x + y * y + z * z);
    motionState.shake = motionState.acceleration >= 12;
    motionState.rotationRate = event.rotationRate ? {
      alpha: Number(event.rotationRate.alpha) || 0,
      beta: Number(event.rotationRate.beta) || 0,
      gamma: Number(event.rotationRate.gamma) || 0
    } : null;
    emitMotion();
  }
  window.AiyaBodyMotion = {
    version: 1,
    supported: 'DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window,
    start: async function (listener) {
      var PermissionCtor = window.DeviceOrientationEvent;
      if (PermissionCtor && typeof PermissionCtor.requestPermission === 'function') {
        var permission = await PermissionCtor.requestPermission();
        if (permission !== 'granted') throw new Error('motion_permission_denied');
      }
      if (typeof listener === 'function' && motionListeners.indexOf(listener) < 0) motionListeners.push(listener);
      if (!motionStarted) {
        motionStarted = true;
        window.addEventListener('deviceorientation', onOrientation, true);
        window.addEventListener('devicemotion', onDeviceMotion, true);
      }
      return Object.assign({}, motionState);
    },
    calibrate: function () {
      motionBase = { alpha: motionState.alpha, beta: motionState.beta, gamma: motionState.gamma };
      return Object.assign({}, motionBase);
    },
    current: function () { return Object.assign({}, motionState); },
    removeListener: function (listener) {
      motionListeners = motionListeners.filter(function (item) { return item !== listener; });
    },
    stop: function () {
      motionListeners = [];
      if (!motionStarted) return;
      motionStarted = false;
      window.removeEventListener('deviceorientation', onOrientation, true);
      window.removeEventListener('devicemotion', onDeviceMotion, true);
      if (motionFrame) cancelAnimationFrame(motionFrame);
      motionFrame = 0;
    }
  };
})();
</script>
""".trimIndent()

private fun appInteractionRecorderScript(): String = """
<script id="aiya-v3-app-interaction-recorder">
(function () {
  if (window.__AIYA_V3_APP_RECORDER_INSTALLED__) return;
  window.__AIYA_V3_APP_RECORDER_INSTALLED__ = true;
  var seq = 0;
  var batch = [];
  var timer = 0;
  var maxBatch = 12;
  var flushDelay = 900;

  function now() { return Date.now(); }
  function bridge() { return window.AiyaAppInteraction && typeof window.AiyaAppInteraction.record === 'function' ? window.AiyaAppInteraction : null; }
  function shortText(value, max) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + '…' : text;
  }
  function rectOf(el) {
    try {
      var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null;
    } catch (e) { return null; }
  }
  function pathOf(el) {
    var parts = [];
    var node = el;
    for (var i = 0; node && node.nodeType === 1 && i < 5; i += 1) {
      var part = String(node.tagName || '').toLowerCase();
      if (node.id) part += '#' + node.id;
      if (node.className && typeof node.className === 'string') {
        var cls = node.className.trim().split(/\s+/).slice(0, 3).join('.');
        if (cls) part += '.' + cls;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join('>');
  }
  function targetInfo(el) {
    if (!el || el.nodeType !== 1) return null;
    var value = '';
    try {
      if ('value' in el) value = shortText(el.value, 80);
    } catch (e) {}
    return {
      tag: String(el.tagName || '').toLowerCase(),
      id: el.id || '',
      className: typeof el.className === 'string' ? shortText(el.className, 120) : '',
      role: el.getAttribute && (el.getAttribute('role') || ''),
      type: el.getAttribute && (el.getAttribute('type') || ''),
      aria: el.getAttribute && (el.getAttribute('aria-label') || ''),
      dataAction: el.getAttribute && (el.getAttribute('data-action') || el.getAttribute('data-key') || el.getAttribute('data-value') || el.getAttribute('data-dir') || ''),
      text: shortText(el.innerText || el.textContent || '', 120),
      value: value,
      path: pathOf(el),
      rect: rectOf(el)
    };
  }
  function displaySnapshot() {
    var selectors = [
      '[id*="display" i]', '[class*="display" i]', '[id*="screen" i]', '[class*="screen" i]',
      '[id*="result" i]', '[class*="result" i]', '[id*="output" i]', '[class*="output" i]',
      'input', 'textarea'
    ];
    var seen = [];
    var out = [];
    selectors.forEach(function (sel) {
      var nodes = [];
      try { nodes = Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) {}
      nodes.slice(0, 8).forEach(function (node) {
        if (seen.indexOf(node) >= 0 || out.length >= 10) return;
        seen.push(node);
        var text = '';
        try { text = ('value' in node && node.value !== undefined) ? node.value : (node.innerText || node.textContent || ''); } catch (e) {}
        out.push({ path: pathOf(node), text: shortText(text, 160), rect: rectOf(node) });
      });
    });
    return out;
  }
  function pageState() {
    return {
      url: location.href,
      title: document.title || '',
      viewport: { w: window.innerWidth || 0, h: window.innerHeight || 0, dpr: window.devicePixelRatio || 1 },
      scroll: { x: Math.round(window.scrollX || 0), y: Math.round(window.scrollY || 0) },
      active: targetInfo(document.activeElement),
      displays: displaySnapshot()
    };
  }
  function add(type, detail, force) {
    var event = {
      seq: ++seq,
      type: type,
      at: now(),
      detail: detail || {},
      state: pageState()
    };
    batch.push(event);
    if (force || batch.length >= maxBatch) flush();
    else if (!timer) timer = setTimeout(flush, flushDelay);
  }
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (!batch.length) return;
    var events = batch.splice(0, batch.length);
    var b = bridge();
    if (!b) return;
    try {
      b.record(JSON.stringify({ sentAt: now(), href: location.href, title: document.title || '', events: events }));
    } catch (e) {}
  }
  function pointerDetail(e) {
    var touch = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : (e.touches && e.touches[0] ? e.touches[0] : null);
    var x = touch ? touch.clientX : e.clientX;
    var y = touch ? touch.clientY : e.clientY;
    return {
      target: targetInfo(e.target),
      x: Math.round(x || 0),
      y: Math.round(y || 0),
      pointerType: e.pointerType || (touch ? 'touch' : 'mouse'),
      button: e.button,
      cancelable: Boolean(e.cancelable),
      defaultPrevented: Boolean(e.defaultPrevented)
    };
  }
  ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend'].forEach(function (name) {
    document.addEventListener(name, function (e) {
      add(name, pointerDetail(e), false);
      if (name === 'click' || name === 'touchend' || name === 'pointerup') {
        setTimeout(function () { add(name + ':after', { target: targetInfo(e.target) }, false); }, 80);
      }
    }, true);
  });
  ['keydown', 'keyup'].forEach(function (name) {
    document.addEventListener(name, function (e) {
      add(name, { key: e.key, code: e.code, target: targetInfo(e.target), defaultPrevented: Boolean(e.defaultPrevented) }, false);
    }, true);
  });
  ['input', 'change'].forEach(function (name) {
    document.addEventListener(name, function (e) {
      add(name, { target: targetInfo(e.target) }, false);
    }, true);
  });
  window.addEventListener('error', function (e) {
    add('js-error', { message: e.message, source: e.filename, line: e.lineno, column: e.colno, error: shortText(e.error && (e.error.stack || e.error.message), 1000) }, true);
  });
  window.addEventListener('unhandledrejection', function (e) {
    add('unhandled-rejection', { reason: shortText(e.reason && (e.reason.stack || e.reason.message || e.reason), 1000) }, true);
  });
  ['log', 'warn', 'error'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments).map(function (item) {
        if (item instanceof Error) return item.stack || item.message;
        if (typeof item === 'object') {
          try { return JSON.stringify(item); } catch (e) { return String(item); }
        }
        return String(item);
      });
      add('console-' + level, { args: shortText(args.join(' '), 1200) }, level !== 'log');
      return original && original.apply(console, arguments);
    };
  });
  var mutationTimer = 0;
  try {
    var observer = new MutationObserver(function () {
      if (mutationTimer) return;
      mutationTimer = setTimeout(function () {
        mutationTimer = 0;
        add('dom-mutation', { displays: displaySnapshot() }, false);
      }, 700);
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'disabled', 'aria-disabled'] });
  } catch (e) {}
  document.addEventListener('visibilitychange', function () {
    add('visibilitychange', { hidden: document.hidden }, true);
  });
  window.addEventListener('beforeunload', function () { flush(); });
  document.addEventListener('DOMContentLoaded', function () { add('dom-content-loaded', {}, true); });
  window.addEventListener('load', function () { add('window-load', {}, true); });
  add('recorder-installed', {}, true);
})();
</script>
""".trimIndent()

private class AppInteractionBridge(
    private val context: Context,
    title: String,
    html: String,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val speechController = AndroidTeacherVoiceController(context, mainHandler)
    private val bodyVisionEngine = AiyaBodyVisionEngine(context)
    private val interactionId = "cti_${System.currentTimeMillis()}_${UUID.randomUUID().toString().replace("-", "").take(10)}"
    private val sessionId = "apk_${System.currentTimeMillis()}_${UUID.randomUUID().toString().replace("-", "").take(8)}"
    @Volatile private var workTitle = title.ifBlank { "AIYA 作品" }
    @Volatile private var htmlHash = sha256Hex(html)
    @Volatile private var htmlLength = html.length

    fun updateWork(title: String, html: String) {
        workTitle = title.ifBlank { "AIYA 作品" }
        htmlHash = sha256Hex(html)
        htmlLength = html.length
    }

    @JavascriptInterface
    fun record(rawPayload: String?) {
        if (!recordRateLimiter.tryAccept()) return
        val trimmed = (rawPayload.orEmpty()).take(60_000)
        val detail = JSONObject()
            .put("source", "android-webview-js-bridge")
            .put("payload", parseJsonOrString(trimmed))
        post(detail)
    }

    @JavascriptInterface
    fun speak(rawText: String?) {
        val text = rawText.orEmpty().trim().take(220)
        if (text.isBlank()) return
        recordNativeEvent("generated-app-speech-request", JSONObject().put("textLength", text.length))
        mainHandler.post {
            speechController.speak(text) { state ->
                val status = when (state.status) {
                    TeacherVoiceStatus.Idle -> "idle"
                    TeacherVoiceStatus.Loading -> "loading"
                    TeacherVoiceStatus.Speaking -> "speaking"
                    is TeacherVoiceStatus.Error -> "error"
                }
                recordNativeEvent("generated-app-speech-state", JSONObject().put("status", status))
            }
        }
    }

    @JavascriptInterface
    fun stopSpeech() {
        mainHandler.post { speechController.stop() }
    }

    @JavascriptInterface
    fun capabilities(): String = bodyVisionEngine.capabilities()

    @JavascriptInterface
    fun analyzeFace(rawFrame: String?): String = bodyVisionEngine.analyzeFace(rawFrame)

    @JavascriptInterface
    fun analyzeGesture(rawFrame: String?): String = bodyVisionEngine.analyzeGesture(rawFrame)

    fun release() {
        bodyVisionEngine.close()
        mainHandler.post { speechController.release() }
    }

    fun recordNativeConsole(consoleMessage: ConsoleMessage?) {
        if (consoleMessage == null) return
        val detail = JSONObject()
            .put("source", "android-webchrome-console")
            .put("level", consoleMessage.messageLevel()?.name ?: "UNKNOWN")
            .put("message", consoleMessage.message().orEmpty().take(2000))
            .put("sourceId", consoleMessage.sourceId().orEmpty().take(500))
            .put("lineNumber", consoleMessage.lineNumber())
        post(detail)
    }

    fun recordNativeEvent(type: String, detail: JSONObject = JSONObject()) {
        post(
            JSONObject()
                .put("source", "android-native")
                .put("type", type)
                .put("detail", detail)
        )
    }

    private fun post(detail: JSONObject) {
        val payload = JSONObject()
            .put("interactionId", interactionId)
            .put("phase", "app-runtime")
            .put("message", "APK app interaction: $workTitle")
            .put("currentAppTitle", workTitle.take(160))
            .put(
                "detail",
                JSONObject()
                    .put("sessionId", sessionId)
                    .put("appId", V3_APP_ID)
                    .put("appVersionName", BuildConfig.VERSION_NAME)
                    .put("appVersionCode", BuildConfig.VERSION_CODE)
                    .put("workTitle", workTitle.take(160))
                    .put("htmlHash", htmlHash)
                    .put("htmlLength", htmlLength)
                    .put("device", deviceSnapshot())
                    .put("event", detail)
            )
        Thread {
            runCatching {
                postJson(INTERACTION_URL, payload)
            }.onSuccess {
                Log.i(AIYA_LOG_TAG, "app-interaction posted id=$interactionId session=$sessionId")
            }.onFailure { error ->
                Log.w(AIYA_LOG_TAG, "app-interaction post failed: ${error.message}")
            }
        }.apply {
            name = "aiya-v3-app-interaction-post"
            isDaemon = true
            start()
        }
    }

    private fun deviceSnapshot() = JSONObject()
        .put("manufacturer", Build.MANUFACTURER)
        .put("model", Build.MODEL)
        .put("sdk", Build.VERSION.SDK_INT)
        .put("release", Build.VERSION.RELEASE)
        .put("packageName", context.packageName)
}

private fun parseJsonOrString(value: String): Any {
    if (value.isBlank()) return ""
    return runCatching { JSONObject(value) }.getOrElse {
        runCatching { JSONArray(value) }.getOrElse { value }
    }
}

private val recordRateLimiter = AiyaRecordRateLimiter(
    minIntervalMs = RECORD_MIN_INTERVAL_MS,
    burstLimit = RECORD_BURST_LIMIT,
    perMinuteLimit = RECORD_TOKEN_BUCKET_PER_MIN,
)

private class AiyaRecordRateLimiter(
    private val minIntervalMs: Long,
    private val burstLimit: Int,
    private val perMinuteLimit: Int,
) {
    private val lock = Any()
    private var lastAcceptedAt = 0L
    private var burstCount = 0
    private var minuteStartAt = 0L
    private var minuteCount = 0

    fun tryAccept(): Boolean {
        val now = System.currentTimeMillis()
        synchronized(lock) {
            if (now - lastAcceptedAt < minIntervalMs) return false
            if (now - minuteStartAt >= 60_000L) {
                minuteStartAt = now
                minuteCount = 0
                burstCount = 0
            }
            if (minuteCount >= perMinuteLimit) return false
            if (burstCount >= burstLimit && now - minuteStartAt < 1_000L) return false
            lastAcceptedAt = now
            burstCount += 1
            minuteCount += 1
            return true
        }
    }
}

private fun saveWorkHtmlEncrypted(context: Context, workId: String, html: String) {
    if (html.isBlank()) return
    val safeId = workId.ifBlank { return }.replace(Regex("[^A-Za-z0-9_-]"), "_").take(80)
    val dir = File(context.filesDir, "works").apply { if (!exists() && !mkdirs()) throw IllegalStateException("cannot create works dir") }
    val target = File(dir, "$safeId.bin")
    // EncryptedFile authenticates the target filename. Encrypting a temporary
    // filename and then renaming it makes the ciphertext permanently unreadable.
    // Keep a best-effort plaintext backup in memory, then rewrite the real target
    // under its final filename.
    val previous = if (target.exists()) readWorkHtmlEncrypted(context, safeId) else null
    if (target.exists() && !target.delete()) throw IllegalStateException("cannot replace encrypted file")
    val masterKey = androidx.security.crypto.MasterKey.Builder(context)
        .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
        .build()
    val encrypted = androidx.security.crypto.EncryptedFile.Builder(
        context,
        target,
        masterKey,
        androidx.security.crypto.EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
    ).build()
    try {
        encrypted.openFileOutput().use { output -> output.write(html.toByteArray(Charsets.UTF_8)) }
    } catch (error: Throwable) {
        if (target.exists()) target.delete()
        if (!previous.isNullOrBlank()) {
            runCatching {
                val restore = androidx.security.crypto.EncryptedFile.Builder(
                    context,
                    target,
                    masterKey,
                    androidx.security.crypto.EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
                ).build()
                restore.openFileOutput().use { output -> output.write(previous.toByteArray(Charsets.UTF_8)) }
            }
        }
        throw error
    }
}

private fun readWorkHtmlEncrypted(context: Context, workId: String): String? {
    val safeId = workId.replace(Regex("[^A-Za-z0-9_-]"), "_").take(80)
    val target = File(File(context.filesDir, "works"), "$safeId.bin")
    if (!target.exists()) return null
    val masterKey = androidx.security.crypto.MasterKey.Builder(context)
        .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
        .build()
    val encrypted = androidx.security.crypto.EncryptedFile.Builder(
        context,
        target,
        masterKey,
        androidx.security.crypto.EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
    ).build()
    return runCatching { encrypted.openFileInput().use { input -> String(input.readBytes(), Charsets.UTF_8) } }.getOrNull()
}

private fun deleteWorkHtmlEncrypted(context: Context, workId: String) {
    val safeId = workId.replace(Regex("[^A-Za-z0-9_-]"), "_").take(80)
    val target = File(File(context.filesDir, "works"), "$safeId.bin")
    if (target.exists()) target.delete()
}

private fun sha256Hex(value: String): String {
    val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    return bytes.joinToString("") { "%02x".format(it) }
}

@Composable
private fun ShowcaseScreen(
    state: ShowcaseState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
) {
    val context = LocalContext.current
    var selectedWorkId by rememberSaveable { mutableStateOf("") }
    var promptWorkId by rememberSaveable { mutableStateOf("") }
    val works = (state as? ShowcaseState.Ready)?.works.orEmpty()
    LaunchedEffect(works) {
        if (works.isNotEmpty() && works.none { it.id == selectedWorkId }) {
            selectedWorkId = works.first().id
        }
    }
    val selectedWork = works.firstOrNull { it.id == selectedWorkId } ?: works.firstOrNull()
    val promptWork = works.firstOrNull { it.id == promptWorkId }
    if (promptWork != null) {
        ShowcasePromptDialog(
            work = promptWork,
            onDismiss = { promptWorkId = "" },
            onCopy = {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("${promptWork.title} 初始提示词", promptWork.initialPrompt))
                Toast.makeText(context, "初始提示词已复制", Toast.LENGTH_SHORT).show()
            },
        )
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(AiyaMist, Color.White))),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, top = 22.dp, end = 16.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                onClick = onBack,
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.White,
                    contentColor = AiyaInk,
                ),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
                elevation = ButtonDefaults.buttonElevation(defaultElevation = 1.dp),
            ) {
                Text("← 返回", fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("优秀作品", color = AiyaInk, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            }
            Text("AIYA", color = AiyaGreen, fontSize = 12.sp, fontWeight = FontWeight.ExtraBold)
        }
        when (state) {
            ShowcaseState.Idle,
            ShowcaseState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = AiyaGreen)
                    Spacer(modifier = Modifier.height(14.dp))
                    Text("正在整理优秀作品", color = Color(0xFF5E706A))
                }
            }
            is ShowcaseState.Failed -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(
                    modifier = Modifier.padding(28.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(state.message, color = Color(0xFF9F3F31), textAlign = TextAlign.Center)
                    Spacer(modifier = Modifier.height(14.dp))
                    Button(onClick = onRetry, colors = ButtonDefaults.buttonColors(containerColor = AiyaGreen)) {
                        Text("重新加载", fontWeight = FontWeight.Bold)
                    }
                }
            }
            is ShowcaseState.Ready -> {
                if (works.isEmpty()) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("优秀作品正在准备中。", color = Color(0xFF5E706A))
                    }
                } else {
                    LazyRow(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(works) { work ->
                            ShowcaseWorkCard(
                                work = work,
                                selected = work.id == selectedWork?.id,
                                onClick = { selectedWorkId = work.id },
                            )
                        }
                    }
                    selectedWork?.let { work ->
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 14.dp, vertical = 6.dp),
                            shape = RoundedCornerShape(16.dp),
                            color = Color(0xFFEFFFF8),
                        ) {
                            Row(
                                modifier = Modifier.padding(start = 14.dp, top = 7.dp, end = 7.dp, bottom = 7.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "好 Demo 从清楚的需求开始",
                                    modifier = Modifier.weight(1f),
                                    color = Color(0xFF45675C),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    maxLines = 1,
                                )
                                Button(
                                    onClick = { promptWorkId = work.id },
                                    enabled = work.initialPrompt.isNotBlank(),
                                    shape = RoundedCornerShape(12.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = AiyaGreen),
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                                ) {
                                    Text("查看初始提示词", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                        GeneratedWorkWebView(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f),
                            title = work.title,
                            html = work.html,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ShowcasePromptDialog(
    work: ShowcaseWork,
    onDismiss: () -> Unit,
    onCopy: () -> Unit,
) {
    val scrollState = rememberScrollState()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Column {
                Text("初始提示词", color = AiyaInk, fontWeight = FontWeight.ExtraBold)
                Text(work.title, color = AiyaGreen, fontSize = 13.sp, fontWeight = FontWeight.Bold)
            }
        },
        text = {
            Column {
                Text(
                    "观察它如何说清场景、规则、操作、反馈和适配要求。",
                    color = Color(0xFF5E706A),
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 360.dp),
                    shape = RoundedCornerShape(16.dp),
                    color = Color(0xFFF1F8F5),
                ) {
                    Text(
                        text = work.initialPrompt,
                        modifier = Modifier
                            .verticalScroll(scrollState)
                            .padding(14.dp),
                        color = AiyaInk,
                        fontSize = 14.sp,
                        lineHeight = 22.sp,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onCopy,
                colors = ButtonDefaults.buttonColors(containerColor = AiyaGreen),
            ) {
                Text("一键复制", fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )
}

@Composable
private fun ShowcaseWorkCard(
    work: ShowcaseWork,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        modifier = Modifier
            .width(218.dp)
            // Metadata must remain readable with the user's system font scale.
            // A fixed height clipped the second line (the model name) on real phones.
            .heightIn(min = 104.dp)
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(20.dp),
        color = if (selected) Color(0xFFE7FFF6) else Color.White,
        shadowElevation = if (selected) 3.dp else 1.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ShowcaseGeneratedIcon(icon = work.icon, modifier = Modifier.size(56.dp))
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    work.title,
                    color = AiyaInk,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    "作者 · ${work.author}",
                    color = Color(0xFF4E665E),
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "模型 · ${work.model}",
                    color = Color(0xFF4E665E),
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun ShowcaseGeneratedIcon(icon: ShowcaseIcon?, modifier: Modifier = Modifier) {
    val palette = icon?.palette.orEmpty()
    val background = when (palette) {
        "ocean" -> Color(0xFF3B82F6)
        "violet" -> Color(0xFF8B5CF6)
        "sunset" -> Color(0xFFF97316)
        "berry" -> Color(0xFFEC4899)
        "sky" -> Color(0xFF06B6D4)
        "lime" -> Color(0xFF65A30D)
        "indigo" -> Color(0xFF6366F1)
        else -> AiyaGreen
    }
    val glyph = when (icon?.symbol) {
        "snake" -> "S"
        "calculator" -> "＋"
        "drawing" -> "✎"
        "game" -> "✦"
        "balloon" -> "●"
        "fan" -> "✺"
        "music" -> "♪"
        "book" -> "▤"
        "rocket" -> "▲"
        "timer" -> "◷"
        "food" -> "餐"
        "camera" -> "◉"
        "chat" -> "…"
        "puzzle" -> "✚"
        else -> "✦"
    }
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(background),
        contentAlignment = Alignment.Center,
    ) {
        Text(glyph, color = Color.White, fontSize = 25.sp, fontWeight = FontWeight.ExtraBold)
        Text(
            "AIYA",
            color = Color.White.copy(alpha = 0.9f),
            fontSize = 6.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 4.dp),
        )
    }
}

@Composable
private fun ExportTab(
    work: GeneratedWork?,
    workLibrary: List<GeneratedWork>,
    exportState: ExportState,
    onSaveHtml: (GeneratedWork) -> Unit,
    onShareHtml: (GeneratedWork) -> Unit,
    onBuildApk: (GeneratedWork) -> Unit,
    onViewSource: (GeneratedWork) -> Unit,
    onSelectWork: (GeneratedWork) -> Unit,
    onDeleteWork: (GeneratedWork) -> Unit,
    onCreateFirst: () -> Unit,
    onOpenShowcase: () -> Unit,
) {
    val hasWork = work != null
    val hasAnyWork = workLibrary.isNotEmpty()
    val working = exportState is ExportState.Working
    ScreenShell(
        eyebrow = "带走",
        title = "带走作品",
        subtitle = if (hasWork) work?.title?.ifBlank { "下载、查看或打包你的作品。" } ?: "下载、查看或打包你的作品。" else "下载、查看或打包你的作品。",
        compactHeader = true,
        scrollable = false,
    ) {
        ExportAction(
            title = "优秀作品展示",
            description = "看看精选互动作品。",
            iconRes = R.drawable.aiya_icon_showcase,
            enabled = true,
            loading = false,
            onClick = onOpenShowcase,
        )
        Spacer(modifier = Modifier.height(7.dp))
        ExportStatusText(exportState)
        if (exportState !is ExportState.Idle) Spacer(modifier = Modifier.height(7.dp))
        if (hasAnyWork) {
            ExportProjectSelector(
                works = workLibrary,
                currentWorkId = work?.id.orEmpty(),
                onSelectWork = onSelectWork,
                onDeleteWork = onDeleteWork,
                deleteEnabled = !working,
            )
            Spacer(modifier = Modifier.height(7.dp))
        }
        ExportAction(
            title = "下载 HTML",
            description = if (hasWork) "保存到下载目录。" else "先选择作品。",
            iconRes = R.drawable.aiya_icon_download_html,
            enabled = hasWork && !working,
            loading = working && exportState.message.contains("HTML"),
            onClick = { work?.let(onSaveHtml) },
            secondaryActionLabel = "分享到微信",
            onSecondaryAction = { work?.let(onShareHtml) },
        )
        Spacer(modifier = Modifier.height(7.dp))
        ExportAction(
            title = "生成 APK",
            description = if (hasWork) "生成后打开安装页面。" else "先选择作品。",
            iconRes = R.drawable.aiya_icon_generate_apk,
            enabled = hasWork && !working,
            loading = working && exportState.message.contains("APK"),
            onClick = { work?.let(onBuildApk) },
        )
        Spacer(modifier = Modifier.height(7.dp))
        ExportAction(
            title = "查看源码",
            description = if (hasWork) "多色查看，可一键复制。" else "先选择作品。",
            iconRes = R.drawable.aiya_icon_view_source,
            enabled = hasWork && !working,
            loading = false,
            onClick = { work?.let(onViewSource) },
        )
        if (!hasAnyWork) {
            Spacer(modifier = Modifier.height(12.dp))
            Button(
                modifier = Modifier.fillMaxWidth().height(46.dp),
                shape = RoundedCornerShape(999.dp),
                colors = ButtonDefaults.buttonColors(containerColor = AiyaGreen),
                onClick = onCreateFirst,
            ) { Text("先去创作", fontWeight = FontWeight.Bold) }
        }
    }
}

@Composable
private fun ExportProjectSelector(
    works: List<GeneratedWork>,
    currentWorkId: String,
    onSelectWork: (GeneratedWork) -> Unit,
    onDeleteWork: (GeneratedWork) -> Unit,
    deleteEnabled: Boolean,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = Color.White,
        shadowElevation = 1.dp,
    ) {
        Column(modifier = Modifier.padding(vertical = 8.dp)) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("本机项目", color = AiyaInk, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.width(7.dp))
                Text(
                    text = "${works.size} 个 · 长按标签 3 秒删除",
                    color = Color(0xFF72827C),
                    fontSize = 11.sp,
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(modifier = Modifier.height(5.dp))
            WorkSwitcherRow(
                works = works,
                currentWorkId = currentWorkId,
                onSelectWork = onSelectWork,
                onLongPress = if (deleteEnabled) onDeleteWork else null,
                compact = true,
            )
        }
    }
}

@Composable
private fun ExportStatusText(state: ExportState) {
    val (message, color) = when (state) {
        ExportState.Idle -> return
        is ExportState.Working -> state.message to Color(0xFF12866B)
        is ExportState.Done -> state.message to Color(0xFF12866B)
        is ExportState.Failed -> state.message to Color(0xFF9F3F31)
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        color = Color.White,
        shadowElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (state is ExportState.Working) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = AiyaGreen)
                Spacer(modifier = Modifier.width(10.dp))
            }
            Text(message, color = color, fontSize = 14.sp, lineHeight = 20.sp)
        }
    }
}

@Composable
private fun AppUpdatePanel(
    state: AppUpdateState,
    onDownload: (AppUpdateManifest) -> Unit,
) {
    when (state) {
        AppUpdateState.Idle -> Unit
        AppUpdateState.Checking -> Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(22.dp),
            color = Color.White,
            shadowElevation = 1.dp,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = AiyaGreen)
                Spacer(modifier = Modifier.width(10.dp))
                Text("正在检查 AIYA 更新", color = Color(0xFF72827C), fontSize = 13.sp)
            }
        }
        is AppUpdateState.Current -> Text(
            text = "AIYA ${state.versionName} 已是最新",
            color = Color(0xFF8A9994),
            fontSize = 12.sp,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        is AppUpdateState.Available -> Surface(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onDownload(state.manifest) },
            shape = RoundedCornerShape(22.dp),
            color = Color.White,
            shadowElevation = 2.dp,
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(Color(0xFFD9FFF0)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("新", color = AiyaGreen, fontWeight = FontWeight.ExtraBold)
                }
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("发现新版本 ${state.manifest.versionName}", color = AiyaInk, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(state.manifest.message, color = Color(0xFF72827C), fontSize = 13.sp, lineHeight = 18.sp)
                }
            }
        }
        is AppUpdateState.Downloading -> Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(22.dp),
            color = Color.White,
            shadowElevation = 1.dp,
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = AiyaGreen)
                Spacer(modifier = Modifier.width(10.dp))
                Text("正在下载 AIYA ${state.versionName}", color = Color(0xFF12866B), fontSize = 13.sp)
            }
        }
        is AppUpdateState.Downloaded -> Text(
            text = state.message,
            color = Color(0xFF12866B),
            fontSize = 13.sp,
            lineHeight = 18.sp,
            modifier = Modifier.padding(horizontal = 4.dp),
        )
        is AppUpdateState.Failed -> {
            val manifest = state.manifest
            if (manifest == null) {
                Text(
                    text = state.message,
                    color = Color(0xFF9F3F31),
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            } else {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onDownload(manifest) },
                    shape = RoundedCornerShape(22.dp),
                    color = Color(0xFFFFF7F5),
                    shadowElevation = 1.dp,
                ) {
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                        Text(state.message, color = Color(0xFF9F3F31), fontSize = 13.sp, lineHeight = 18.sp)
                        Spacer(modifier = Modifier.height(4.dp))
                        Text("\u70b9\u51fb\u91cd\u8bd5\u66f4\u65b0", color = Color(0xFFB24E3D), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun ExportAction(
    title: String,
    description: String,
    iconRes: Int,
    enabled: Boolean,
    loading: Boolean,
    onClick: () -> Unit,
    secondaryActionLabel: String? = null,
    onSecondaryAction: (() -> Unit)? = null,
) {
    val bg = if (enabled) Color.White else Color(0xFFF2F5F4)
    val titleColor = if (enabled) AiyaInk else Color(0xFF94A39E)
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick),
        shape = RoundedCornerShape(26.dp),
        color = bg,
        tonalElevation = 0.dp,
        shadowElevation = if (enabled) 2.dp else 0.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (enabled) Color(0xFFF4FFFB) else Color(0xFFE8EEEC)),
                contentAlignment = Alignment.Center,
            ) {
                if (loading) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = AiyaGreen)
                } else {
                    Image(
                        painter = painterResource(iconRes),
                        contentDescription = title,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.size(42.dp),
                    )
                }
            }
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(title, color = titleColor, fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(1.dp))
                Text(
                    description,
                    color = Color(0xFF72827C),
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    maxLines = 1,
                )
            }
            if (secondaryActionLabel != null && onSecondaryAction != null) {
                TextButton(
                    onClick = onSecondaryAction,
                    enabled = enabled,
                ) {
                    Text("微信", color = if (enabled) AiyaGreen else Color(0xFF94A39E), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun SourceViewerDialog(
    work: GeneratedWork,
    onDismiss: () -> Unit,
    onCopy: () -> Unit,
) {
    val sourceLines = remember(work.id, work.html) { work.html.lines().ifEmpty { listOf("") } }
    val verticalScroll = rememberScrollState()
    val horizontalScroll = rememberScrollState()
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            shape = RoundedCornerShape(28.dp),
            color = Color(0xFFF9FCFB),
            tonalElevation = 2.dp,
            shadowElevation = 8.dp,
        ) {
            Column(modifier = Modifier.padding(18.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("查看源码", color = AiyaInk, fontSize = 23.sp, fontWeight = FontWeight.ExtraBold)
                        Spacer(modifier = Modifier.height(3.dp))
                        Text(
                            text = work.title.ifBlank { "AIYA 作品" },
                            color = Color(0xFF5E706A),
                            fontSize = 13.sp,
                            maxLines = 1,
                        )
                        Text(
                            text = "代码区域支持左右、上下滑动",
                            color = Color(0xFF72827C),
                            fontSize = 11.sp,
                        )
                    }
                    TextButton(onClick = onDismiss) {
                        Text("关闭", color = Color(0xFF52756B), fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(modifier = Modifier.height(14.dp))
                Button(
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    shape = RoundedCornerShape(16.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = AiyaGreen),
                    onClick = onCopy,
                ) {
                    Text("一键复制源码", fontWeight = FontWeight.Bold)
                }
                Spacer(modifier = Modifier.height(14.dp))
                BoxWithConstraints(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .clip(RoundedCornerShape(18.dp))
                        .background(Color(0xFF13231F)),
                ) {
                    val density = LocalDensity.current
                    val viewportHeightPx = with(density) { maxHeight.toPx() }
                    val viewportWidthPx = with(density) { maxWidth.toPx() }
                    val verticalThumbFraction = if (verticalScroll.maxValue <= 0) 1f else {
                        (viewportHeightPx / (viewportHeightPx + verticalScroll.maxValue)).coerceIn(0.14f, 1f)
                    }
                    val horizontalThumbFraction = if (horizontalScroll.maxValue <= 0) 1f else {
                        (viewportWidthPx / (viewportWidthPx + horizontalScroll.maxValue)).coerceIn(0.14f, 1f)
                    }
                    val verticalThumbHeight = (maxHeight * verticalThumbFraction).coerceAtLeast(30.dp)
                    val horizontalThumbWidth = (maxWidth * horizontalThumbFraction).coerceAtLeast(38.dp)
                    val verticalProgress = if (verticalScroll.maxValue == 0) 0f else {
                        verticalScroll.value.toFloat() / verticalScroll.maxValue.toFloat()
                    }
                    val horizontalProgress = if (horizontalScroll.maxValue == 0) 0f else {
                        horizontalScroll.value.toFloat() / horizontalScroll.maxValue.toFloat()
                    }
                    Column(
                        modifier = Modifier
                            .verticalScroll(verticalScroll)
                            .horizontalScroll(horizontalScroll)
                            .padding(start = 12.dp, top = 14.dp, end = 24.dp, bottom = 24.dp),
                    ) {
                        sourceLines.forEachIndexed { index, line ->
                            Row(verticalAlignment = Alignment.Top) {
                                Text(
                                    text = (index + 1).toString().padStart(3, ' '),
                                    color = Color(0xFF6C867D),
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 12.sp,
                                    textAlign = TextAlign.End,
                                    modifier = Modifier.width(36.dp),
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Text(
                                    text = highlightSourceLine(line),
                                    color = Color(0xFFE6F1ED),
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 12.sp,
                                    lineHeight = 18.sp,
                                    softWrap = false,
                                )
                            }
                        }
                    }
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(end = 5.dp)
                            .width(5.dp)
                            .height(maxHeight)
                            .clip(CircleShape)
                            .background(Color(0xFF355149)),
                    )
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(end = 5.dp)
                            .offset(y = (maxHeight - verticalThumbHeight) * verticalProgress)
                            .width(5.dp)
                            .height(verticalThumbHeight)
                            .clip(CircleShape)
                            .background(Color(0xFF8DE0C2)),
                    )
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(bottom = 5.dp)
                            .height(5.dp)
                            .width(maxWidth)
                            .clip(CircleShape)
                            .background(Color(0xFF355149)),
                    )
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomStart)
                            .padding(bottom = 5.dp)
                            .offset(x = (maxWidth - horizontalThumbWidth) * horizontalProgress)
                            .height(5.dp)
                            .width(horizontalThumbWidth)
                            .clip(CircleShape)
                            .background(Color(0xFF8DE0C2)),
                    )
                }
            }
        }
    }
}

private val sourceTokenRegex = Regex(
    """<!--.*?-->|<!DOCTYPE[^>]*>|</?[A-Za-z][A-Za-z0-9:_-]*|\b[A-Za-z_:][-A-Za-z0-9_:.]*(?=\s*=)|\"(?:\\.|[^\"])*\"|'(?:\\.|[^'])*'|\b(?:const|let|var|function|return|if|else|for|while|class|new|true|false|null|undefined|async|await|import|from|export|window|document)\b|\b\d+(?:\.\d+)?\b""",
)

private fun highlightSourceLine(line: String): AnnotatedString = buildAnnotatedString {
    var cursor = 0
    sourceTokenRegex.findAll(line).forEach { match ->
        append(line.substring(cursor, match.range.first))
        val token = match.value
        val color = when {
            token.startsWith("<!--") || token.startsWith("<!DOCTYPE") -> Color(0xFF7E9B91)
            token.startsWith("<") -> Color(0xFF57D2A8)
            token.startsWith('"') || token.startsWith('\'') -> Color(0xFFFFC56A)
            token.firstOrNull()?.isDigit() == true -> Color(0xFF8BBFFF)
            token in sourceKeywords -> Color(0xFFC7A6FF)
            else -> Color(0xFF79D9F2)
        }
        withStyle(SpanStyle(color = color)) { append(token) }
        cursor = match.range.last + 1
    }
    append(line.substring(cursor))
}

private val sourceKeywords = setOf(
    "const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "new",
    "true", "false", "null", "undefined", "async", "await", "import", "from", "export", "window", "document",
)

@Preview(showBackground = true, widthDp = 390, heightDp = 844)
@Composable
private fun AiyaV3Preview() {
    AiyaV3App()
}
