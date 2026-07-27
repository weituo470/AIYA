package cc.shenliu.aiya.v3

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizer
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizerResult
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Local-only body vision runtime exposed to generated work through a JavaScript
 * bridge. Camera ownership stays in the generated page; this class receives a
 * deliberately small JPEG frame and returns only compact recognition values.
 * No image is written to disk, logged, or uploaded.
 */
internal class AiyaBodyVisionEngine(
    context: Context,
) : Closeable {
    private val appContext = context.applicationContext
    private val lock = Any()
    private var faceLandmarker: FaceLandmarker? = null
    private var gestureRecognizer: GestureRecognizer? = null
    private var faceInitError: String? = null
    private var gestureInitError: String? = null
    private var lastFaceAt = 0L
    private var lastGestureAt = 0L
    private var lastFaceJson: String? = null
    private var lastGestureJson: String? = null
    private var closed = false

    fun capabilities(): String = JSONObject()
        .put("ok", true)
        .put("version", BODY_VISION_API_VERSION)
        .put("localOnly", true)
        .put("maxFrameEdge", MAX_FRAME_EDGE)
        .put("recommendedFps", RECOMMENDED_FPS)
        .put("face", assetExists(FACE_MODEL_ASSET))
        .put("faceBlendshapes", assetExists(FACE_MODEL_ASSET))
        .put("headPose", assetExists(FACE_MODEL_ASSET))
        .put("gaze", assetExists(FACE_MODEL_ASSET))
        .put("gesture", assetExists(GESTURE_MODEL_ASSET))
        .put("cannedGestures", JSONArray(GESTURE_LABELS.keys.toList()))
        .toString()

    fun analyzeFace(rawFrame: String?): String = synchronized(lock) {
        if (closed) return@synchronized error("released", "体感识别已停止")
        val now = SystemClock.elapsedRealtime()
        cachedResult(now, lastFaceAt, lastFaceJson)?.let { return@synchronized it }

        val bitmap = try {
            decodeFrame(rawFrame)
        } catch (error: FrameInputException) {
            return@synchronized error(error.code, error.message ?: "画面不可用")
        }
        try {
            val landmarker = ensureFaceLandmarker()
                ?: return@synchronized error("face_unavailable", faceInitError ?: "人脸模型不可用")
            val startedAt = SystemClock.elapsedRealtime()
            val mpImage = BitmapImageBuilder(bitmap).build()
            val result = try {
                landmarker.detect(mpImage)
            } finally {
                mpImage.close()
            }
            buildFaceJson(result, SystemClock.elapsedRealtime() - startedAt).also {
                lastFaceAt = now
                lastFaceJson = it
            }
        } catch (throwable: Throwable) {
            Log.w(TAG, "Face inference failed", throwable)
            error("face_inference_failed", throwable.safeMessage("人脸识别失败"))
        } finally {
            bitmap.recycle()
        }
    }

    fun analyzeGesture(rawFrame: String?): String = synchronized(lock) {
        if (closed) return@synchronized error("released", "体感识别已停止")
        val now = SystemClock.elapsedRealtime()
        cachedResult(now, lastGestureAt, lastGestureJson)?.let { return@synchronized it }

        val bitmap = try {
            decodeFrame(rawFrame)
        } catch (error: FrameInputException) {
            return@synchronized error(error.code, error.message ?: "画面不可用")
        }
        try {
            val recognizer = ensureGestureRecognizer()
                ?: return@synchronized error("gesture_unavailable", gestureInitError ?: "手势模型不可用")
            val startedAt = SystemClock.elapsedRealtime()
            val mpImage = BitmapImageBuilder(bitmap).build()
            val result = try {
                recognizer.recognize(mpImage)
            } finally {
                mpImage.close()
            }
            buildGestureJson(result, SystemClock.elapsedRealtime() - startedAt).also {
                lastGestureAt = now
                lastGestureJson = it
            }
        } catch (throwable: Throwable) {
            Log.w(TAG, "Gesture inference failed", throwable)
            error("gesture_inference_failed", throwable.safeMessage("手势识别失败"))
        } finally {
            bitmap.recycle()
        }
    }

    override fun close() = synchronized(lock) {
        if (closed) return@synchronized
        closed = true
        runCatching { faceLandmarker?.close() }
        runCatching { gestureRecognizer?.close() }
        faceLandmarker = null
        gestureRecognizer = null
        lastFaceJson = null
        lastGestureJson = null
    }

    private fun ensureFaceLandmarker(): FaceLandmarker? {
        faceLandmarker?.let { return it }
        if (faceInitError != null) return null
        return runCatching {
            val baseOptions = BaseOptions.builder()
                .setDelegate(Delegate.CPU)
                .setModelAssetPath(FACE_MODEL_ASSET)
                .build()
            val options = FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(baseOptions)
                .setRunningMode(RunningMode.IMAGE)
                .setNumFaces(1)
                .setMinFaceDetectionConfidence(0.5f)
                .setMinFacePresenceConfidence(0.5f)
                .setMinTrackingConfidence(0.5f)
                .setOutputFaceBlendshapes(true)
                .setOutputFacialTransformationMatrixes(true)
                .build()
            FaceLandmarker.createFromOptions(appContext, options).also { faceLandmarker = it }
        }.onFailure {
            faceInitError = it.safeMessage("人脸模型初始化失败")
            Log.e(TAG, "Unable to initialize FaceLandmarker", it)
        }.getOrNull()
    }

    private fun ensureGestureRecognizer(): GestureRecognizer? {
        gestureRecognizer?.let { return it }
        if (gestureInitError != null) return null
        return runCatching {
            val baseOptions = BaseOptions.builder()
                .setDelegate(Delegate.CPU)
                .setModelAssetPath(GESTURE_MODEL_ASSET)
                .build()
            val options = GestureRecognizer.GestureRecognizerOptions.builder()
                .setBaseOptions(baseOptions)
                .setRunningMode(RunningMode.IMAGE)
                .setNumHands(1)
                .setMinHandDetectionConfidence(0.5f)
                .setMinHandPresenceConfidence(0.5f)
                .setMinTrackingConfidence(0.5f)
                .build()
            GestureRecognizer.createFromOptions(appContext, options).also { gestureRecognizer = it }
        }.onFailure {
            gestureInitError = it.safeMessage("手势模型初始化失败")
            Log.e(TAG, "Unable to initialize GestureRecognizer", it)
        }.getOrNull()
    }

    private fun buildFaceJson(result: FaceLandmarkerResult, inferenceMs: Long): String {
        val faces = result.faceLandmarks()
        if (faces.isEmpty()) {
            return JSONObject()
                .put("ok", true)
                .put("faceDetected", false)
                .put("faceCount", 0)
                .put("inferenceMs", inferenceMs)
                .toString()
        }

        val blendshapes = result.faceBlendshapes().orElse(emptyList())
            .firstOrNull()
            .orEmpty()
            .associate { it.categoryName() to it.score().coerceIn(0f, 1f).toDouble() }
        fun score(name: String) = blendshapes[name] ?: 0.0
        fun pair(left: String, right: String) = (score(left) + score(right)) / 2.0

        val blinkLeft = score("eyeBlinkLeft")
        val blinkRight = score("eyeBlinkRight")
        val eyeWideLeft = score("eyeWideLeft")
        val eyeWideRight = score("eyeWideRight")
        val leftEyeOpen = (1.0 - blinkLeft + eyeWideLeft * 0.15).coerceIn(0.0, 1.0)
        val rightEyeOpen = (1.0 - blinkRight + eyeWideRight * 0.15).coerceIn(0.0, 1.0)
        val lookLeft = pair("eyeLookOutLeft", "eyeLookInRight")
        val lookRight = pair("eyeLookInLeft", "eyeLookOutRight")
        val lookUp = pair("eyeLookUpLeft", "eyeLookUpRight")
        val lookDown = pair("eyeLookDownLeft", "eyeLookDownRight")
        val gazeX = (lookRight - lookLeft).coerceIn(-1.0, 1.0)
        val gazeY = (lookDown - lookUp).coerceIn(-1.0, 1.0)
        val gazeConfidence = min(leftEyeOpen, rightEyeOpen).coerceIn(0.0, 1.0)
        val gazeDirection = when {
            gazeConfidence < 0.28 -> "eyes_closed"
            abs(gazeX) < 0.09 && abs(gazeY) < 0.09 -> "center"
            abs(gazeX) >= abs(gazeY) -> if (gazeX >= 0.0) "right" else "left"
            gazeY >= 0.0 -> "down"
            else -> "up"
        }
        val gazeDirectionZh = when (gazeDirection) {
            "left" -> "左"
            "right" -> "右"
            "up" -> "上"
            "down" -> "下"
            "eyes_closed" -> "闭眼"
            else -> "中央"
        }
        val jawOpen = score("jawOpen")
        val smile = pair("mouthSmileLeft", "mouthSmileRight")
        val pucker = score("mouthPucker")
        val cheekPuff = score("cheekPuff")
        val stretch = pair("mouthStretchLeft", "mouthStretchRight")
        val noseSneer = pair("noseSneerLeft", "noseSneerRight")
        val asymmetry = max(
            abs(score("mouthSmileLeft") - score("mouthSmileRight")),
            max(
                abs(score("eyeBlinkLeft") - score("eyeBlinkRight")),
                abs(score("mouthStretchLeft") - score("mouthStretchRight")),
            ),
        ).coerceIn(0.0, 1.0)
        val weirdness = max(
            max(pucker, cheekPuff),
            max(max(stretch, noseSneer), asymmetry),
        ).coerceIn(0.0, 1.0)

        val selectedBlendshapes = JSONObject()
        SELECTED_BLENDSHAPES.forEach { name -> selectedBlendshapes.put(name, round3(score(name))) }

        val faceLandmarks = faces.first()
        val faceBox = if (faceLandmarks.isEmpty()) null else {
            var minX = 1f
            var minY = 1f
            var maxX = 0f
            var maxY = 0f
            faceLandmarks.forEach { point ->
                minX = min(minX, point.x())
                minY = min(minY, point.y())
                maxX = max(maxX, point.x())
                maxY = max(maxY, point.y())
            }
            JSONObject()
                .put("x", round3(minX.toDouble()))
                .put("y", round3(minY.toDouble()))
                .put("width", round3((maxX - minX).toDouble()))
                .put("height", round3((maxY - minY).toDouble()))
        }

        val poseMatrix = result.facialTransformationMatrixes().orElse(emptyList()).firstOrNull()
        val pose = poseMatrix?.takeIf { it.size >= 11 }?.let(::poseFromMatrix)

        return JSONObject()
            .put("ok", true)
            .put("faceDetected", true)
            .put("faceCount", faces.size)
            .put("inferenceMs", inferenceMs)
            .put("leftEyeOpen", round3(leftEyeOpen))
            .put("rightEyeOpen", round3(rightEyeOpen))
            .put("leftBlink", blinkLeft >= 0.45)
            .put("rightBlink", blinkRight >= 0.45)
            .put("gazeX", round3(gazeX))
            .put("gazeY", round3(gazeY))
            .put("gazeConfidence", round3(gazeConfidence))
            .put("gazeDirection", gazeDirection)
            .put("gazeDirectionZh", gazeDirectionZh)
            .put("mouthOpen", jawOpen >= 0.35)
            .put("mouthOpenScore", round3(jawOpen))
            .put("smile", smile >= 0.45)
            .put("smileScore", round3(smile))
            .put("asymmetryScore", round3(asymmetry))
            .put("weirdnessScore", round3(weirdness))
            .put("blendshapes", selectedBlendshapes)
            .putOpt("faceBox", faceBox)
            .putOpt("headPose", pose)
            .toString()
    }

    private fun buildGestureJson(result: GestureRecognizerResult, inferenceMs: Long): String {
        val gesture = result.gestures().firstOrNull()?.firstOrNull()
        if (gesture == null || gesture.categoryName() == "None") {
            return JSONObject()
                .put("ok", true)
                .put("handDetected", result.landmarks().isNotEmpty())
                .put("gesture", "None")
                .put("gestureZh", "未识别")
                .put("confidence", round3(gesture?.score()?.toDouble() ?: 0.0))
                .put("inferenceMs", inferenceMs)
                .toString()
        }

        val gestureName = gesture.categoryName()
        val handedness = result.handedness().firstOrNull()?.firstOrNull()?.categoryName().orEmpty()
        val landmarks = result.landmarks().firstOrNull().orEmpty()
        val keyPoints = JSONArray()
        HAND_KEY_POINT_INDICES.forEach { index ->
            landmarks.getOrNull(index)?.let { point ->
                keyPoints.put(
                    JSONObject()
                        .put("index", index)
                        .put("x", round3(point.x().toDouble()))
                        .put("y", round3(point.y().toDouble())),
                )
            }
        }
        return JSONObject()
            .put("ok", true)
            .put("handDetected", true)
            .put("gesture", gestureName)
            .put("gestureZh", GESTURE_LABELS[gestureName] ?: gestureName)
            .put("confidence", round3(gesture.score().toDouble()))
            .put("handedness", handedness)
            .put("keyPoints", keyPoints)
            .put("inferenceMs", inferenceMs)
            .toString()
    }

    private fun poseFromMatrix(matrix: FloatArray): JSONObject {
        // MediaPipe returns a row-major 4x4 facial transform. The names are
        // intentionally marked approximate because front-camera mirroring can
        // invert yaw/roll for a particular generated work.
        val r00 = matrix[0].toDouble()
        val r10 = matrix[4].toDouble()
        val r20 = matrix[8].toDouble()
        val r21 = matrix[9].toDouble()
        val r22 = matrix[10].toDouble()
        val pitch = atan2(-r20, sqrt(r00 * r00 + r10 * r10)) * RAD_TO_DEG
        val yaw = atan2(r21, r22) * RAD_TO_DEG
        val roll = atan2(r10, r00) * RAD_TO_DEG
        return JSONObject()
            .put("yaw", round2(yaw))
            .put("pitch", round2(pitch))
            .put("roll", round2(roll))
    }

    private fun decodeFrame(rawFrame: String?): Bitmap {
        val raw = rawFrame.orEmpty()
        if (raw.length !in MIN_FRAME_CHARS..MAX_FRAME_CHARS) {
            throw FrameInputException("frame_size", "摄像头画面大小不合规")
        }
        val comma = raw.indexOf(',')
        if (comma <= 0) throw FrameInputException("frame_format", "摄像头画面格式不正确")
        val prefix = raw.substring(0, comma).lowercase()
        if (prefix !in ALLOWED_DATA_URL_PREFIXES) {
            throw FrameInputException("frame_type", "仅支持 JPEG 或 PNG 画面")
        }
        val encoded = raw.substring(comma + 1)
        val bytes = try {
            Base64.decode(encoded, Base64.DEFAULT)
        } catch (_: IllegalArgumentException) {
            throw FrameInputException("frame_base64", "摄像头画面无法解码")
        }
        if (bytes.size !in MIN_FRAME_BYTES..MAX_FRAME_BYTES) {
            throw FrameInputException("frame_bytes", "摄像头画面大小不合规")
        }

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > MAX_SOURCE_EDGE || bounds.outHeight > MAX_SOURCE_EDGE) {
            throw FrameInputException("frame_dimensions", "摄像头画面尺寸不合规")
        }
        var sampleSize = 1
        while (max(bounds.outWidth, bounds.outHeight) / sampleSize > MAX_FRAME_EDGE * 2) sampleSize *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            ?: throw FrameInputException("frame_decode", "摄像头画面无法读取")
        if (max(decoded.width, decoded.height) <= MAX_FRAME_EDGE) return decoded
        val scale = MAX_FRAME_EDGE.toFloat() / max(decoded.width, decoded.height).toFloat()
        val scaled = Bitmap.createScaledBitmap(
            decoded,
            max(1, (decoded.width * scale).toInt()),
            max(1, (decoded.height * scale).toInt()),
            true,
        )
        if (scaled !== decoded) decoded.recycle()
        return scaled
    }

    private fun cachedResult(now: Long, lastAt: Long, lastJson: String?): String? {
        if (lastJson == null || now - lastAt >= MIN_INFERENCE_INTERVAL_MS) return null
        return runCatching { JSONObject(lastJson).put("cached", true).toString() }.getOrDefault(lastJson)
    }

    private fun assetExists(path: String): Boolean = runCatching {
        appContext.assets.open(path).use { true }
    }.getOrDefault(false)

    private fun error(code: String, message: String): String = JSONObject()
        .put("ok", false)
        .put("error", code)
        .put("message", message.take(160))
        .toString()

    private class FrameInputException(
        val code: String,
        message: String,
    ) : IllegalArgumentException(message)

    private companion object {
        const val TAG = "AiyaBodyVision"
        const val BODY_VISION_API_VERSION = 2
        const val FACE_MODEL_ASSET = "aiya_body/face_landmarker.task"
        const val GESTURE_MODEL_ASSET = "aiya_body/gesture_recognizer.task"
        const val MAX_FRAME_EDGE = 384
        const val MAX_SOURCE_EDGE = 4096
        const val RECOMMENDED_FPS = 5
        const val MIN_INFERENCE_INTERVAL_MS = 140L
        const val MIN_FRAME_CHARS = 128
        const val MAX_FRAME_CHARS = 900_000
        const val MIN_FRAME_BYTES = 64
        const val MAX_FRAME_BYTES = 650_000
        const val RAD_TO_DEG = 57.29577951308232

        val ALLOWED_DATA_URL_PREFIXES = setOf(
            "data:image/jpeg;base64",
            "data:image/jpg;base64",
            "data:image/png;base64",
        )
        val HAND_KEY_POINT_INDICES = listOf(0, 4, 8, 12, 16, 20)
        val GESTURE_LABELS = linkedMapOf(
            "Closed_Fist" to "石头",
            "Open_Palm" to "布",
            "Victory" to "剪刀",
            "Pointing_Up" to "向上指",
            "Thumb_Up" to "点赞",
            "Thumb_Down" to "倒赞",
            "ILoveYou" to "我爱你",
        )
        val SELECTED_BLENDSHAPES = listOf(
            "eyeBlinkLeft",
            "eyeBlinkRight",
            "eyeWideLeft",
            "eyeWideRight",
            "eyeSquintLeft",
            "eyeSquintRight",
            "eyeLookDownLeft",
            "eyeLookDownRight",
            "eyeLookInLeft",
            "eyeLookInRight",
            "eyeLookOutLeft",
            "eyeLookOutRight",
            "eyeLookUpLeft",
            "eyeLookUpRight",
            "jawOpen",
            "mouthSmileLeft",
            "mouthSmileRight",
            "mouthPucker",
            "mouthStretchLeft",
            "mouthStretchRight",
            "cheekPuff",
            "noseSneerLeft",
            "noseSneerRight",
        )

        fun round2(value: Double): Double = kotlin.math.round(value * 100.0) / 100.0
        fun round3(value: Double): Double = kotlin.math.round(value * 1000.0) / 1000.0
        fun Throwable.safeMessage(fallback: String): String = message.orEmpty().trim().take(160).ifBlank { fallback }
    }
}
