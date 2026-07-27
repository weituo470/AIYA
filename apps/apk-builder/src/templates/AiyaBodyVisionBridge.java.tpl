package __PACKAGE__;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.components.containers.Category;
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.core.Delegate;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker;
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult;
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizer;
import com.google.mediapipe.tasks.vision.gesturerecognizer.GestureRecognizerResult;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.Closeable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Offline, local-only recognition bridge for an AIYA-generated APK.
 * Frames are bounded, decoded in memory, analyzed on device and never saved or
 * uploaded. Keep this API aligned with AIYA V3's preview bridge.
 */
public final class AiyaBodyVisionBridge implements Closeable {
    private static final String TAG = "AiyaBodyVision";
    private static final String FACE_MODEL = "aiya_body/face_landmarker.task";
    private static final String GESTURE_MODEL = "aiya_body/gesture_recognizer.task";
    private static final int MAX_FRAME_EDGE = 384;
    private static final int MAX_SOURCE_EDGE = 4096;
    private static final int MIN_FRAME_CHARS = 128;
    private static final int MAX_FRAME_CHARS = 900000;
    private static final int MIN_FRAME_BYTES = 64;
    private static final int MAX_FRAME_BYTES = 650000;
    private static final long MIN_INTERVAL_MS = 140L;

    private final Context context;
    private final Object lock = new Object();
    private FaceLandmarker faceLandmarker;
    private GestureRecognizer gestureRecognizer;
    private String faceInitError;
    private String gestureInitError;
    private long lastFaceAt;
    private long lastGestureAt;
    private String lastFaceJson;
    private String lastGestureJson;
    private boolean closed;

    public AiyaBodyVisionBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public String capabilities() {
        try {
            return new JSONObject()
                .put("ok", true)
                .put("version", 2)
                .put("localOnly", true)
                .put("maxFrameEdge", MAX_FRAME_EDGE)
                .put("recommendedFps", 5)
                .put("face", assetExists(FACE_MODEL))
                .put("faceBlendshapes", assetExists(FACE_MODEL))
                .put("headPose", assetExists(FACE_MODEL))
                .put("gaze", assetExists(FACE_MODEL))
                .put("gesture", assetExists(GESTURE_MODEL))
                .put("cannedGestures", new JSONArray(gestureLabels().keySet()))
                .toString();
        } catch (JSONException jsonError) {
            return error("capabilities_failed", "体感能力读取失败");
        }
    }

    @JavascriptInterface
    public String analyzeFace(String rawFrame) {
        synchronized (lock) {
            if (closed) return error("released", "体感识别已停止");
            long now = SystemClock.elapsedRealtime();
            String cached = cached(now, lastFaceAt, lastFaceJson);
            if (cached != null) return cached;
            Bitmap bitmap;
            try {
                bitmap = decodeFrame(rawFrame);
            } catch (FrameInputException inputError) {
                return error(inputError.code, inputError.getMessage());
            }
            try {
                FaceLandmarker landmarker = ensureFaceLandmarker();
                if (landmarker == null) return error("face_unavailable", valueOr(faceInitError, "人脸模型不可用"));
                long startedAt = SystemClock.elapsedRealtime();
                MPImage image = new BitmapImageBuilder(bitmap).build();
                FaceLandmarkerResult result;
                try {
                    result = landmarker.detect(image);
                } finally {
                    image.close();
                }
                String json = buildFaceJson(result, SystemClock.elapsedRealtime() - startedAt);
                lastFaceAt = now;
                lastFaceJson = json;
                return json;
            } catch (Throwable error) {
                Log.w(TAG, "Face inference failed", error);
                return error("face_inference_failed", safeMessage(error, "人脸识别失败"));
            } finally {
                bitmap.recycle();
            }
        }
    }

    @JavascriptInterface
    public String analyzeGesture(String rawFrame) {
        synchronized (lock) {
            if (closed) return error("released", "体感识别已停止");
            long now = SystemClock.elapsedRealtime();
            String cached = cached(now, lastGestureAt, lastGestureJson);
            if (cached != null) return cached;
            Bitmap bitmap;
            try {
                bitmap = decodeFrame(rawFrame);
            } catch (FrameInputException inputError) {
                return error(inputError.code, inputError.getMessage());
            }
            try {
                GestureRecognizer recognizer = ensureGestureRecognizer();
                if (recognizer == null) return error("gesture_unavailable", valueOr(gestureInitError, "手势模型不可用"));
                long startedAt = SystemClock.elapsedRealtime();
                MPImage image = new BitmapImageBuilder(bitmap).build();
                GestureRecognizerResult result;
                try {
                    result = recognizer.recognize(image);
                } finally {
                    image.close();
                }
                String json = buildGestureJson(result, SystemClock.elapsedRealtime() - startedAt);
                lastGestureAt = now;
                lastGestureJson = json;
                return json;
            } catch (Throwable error) {
                Log.w(TAG, "Gesture inference failed", error);
                return error("gesture_inference_failed", safeMessage(error, "手势识别失败"));
            } finally {
                bitmap.recycle();
            }
        }
    }

    @Override
    public void close() {
        synchronized (lock) {
            if (closed) return;
            closed = true;
            try { if (faceLandmarker != null) faceLandmarker.close(); } catch (Throwable ignored) {}
            try { if (gestureRecognizer != null) gestureRecognizer.close(); } catch (Throwable ignored) {}
            faceLandmarker = null;
            gestureRecognizer = null;
            lastFaceJson = null;
            lastGestureJson = null;
        }
    }

    private FaceLandmarker ensureFaceLandmarker() {
        if (faceLandmarker != null) return faceLandmarker;
        if (faceInitError != null) return null;
        try {
            BaseOptions baseOptions = BaseOptions.builder()
                .setDelegate(Delegate.CPU)
                .setModelAssetPath(FACE_MODEL)
                .build();
            FaceLandmarker.FaceLandmarkerOptions options = FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(baseOptions)
                .setRunningMode(RunningMode.IMAGE)
                .setNumFaces(1)
                .setMinFaceDetectionConfidence(0.5f)
                .setMinFacePresenceConfidence(0.5f)
                .setMinTrackingConfidence(0.5f)
                .setOutputFaceBlendshapes(true)
                .setOutputFacialTransformationMatrixes(true)
                .build();
            faceLandmarker = FaceLandmarker.createFromOptions(context, options);
            return faceLandmarker;
        } catch (Throwable error) {
            faceInitError = safeMessage(error, "人脸模型初始化失败");
            Log.e(TAG, "Unable to initialize FaceLandmarker", error);
            return null;
        }
    }

    private GestureRecognizer ensureGestureRecognizer() {
        if (gestureRecognizer != null) return gestureRecognizer;
        if (gestureInitError != null) return null;
        try {
            BaseOptions baseOptions = BaseOptions.builder()
                .setDelegate(Delegate.CPU)
                .setModelAssetPath(GESTURE_MODEL)
                .build();
            GestureRecognizer.GestureRecognizerOptions options = GestureRecognizer.GestureRecognizerOptions.builder()
                .setBaseOptions(baseOptions)
                .setRunningMode(RunningMode.IMAGE)
                .setNumHands(1)
                .setMinHandDetectionConfidence(0.5f)
                .setMinHandPresenceConfidence(0.5f)
                .setMinTrackingConfidence(0.5f)
                .build();
            gestureRecognizer = GestureRecognizer.createFromOptions(context, options);
            return gestureRecognizer;
        } catch (Throwable error) {
            gestureInitError = safeMessage(error, "手势模型初始化失败");
            Log.e(TAG, "Unable to initialize GestureRecognizer", error);
            return null;
        }
    }

    private String buildFaceJson(FaceLandmarkerResult result, long inferenceMs) throws JSONException {
        List<List<NormalizedLandmark>> faces = result.faceLandmarks();
        if (faces.isEmpty()) {
            return new JSONObject().put("ok", true).put("faceDetected", false).put("faceCount", 0)
                .put("inferenceMs", inferenceMs).toString();
        }
        Map<String, Double> scores = new LinkedHashMap<String, Double>();
        List<List<Category>> blendshapeFaces = result.faceBlendshapes().orElse(Collections.<List<Category>>emptyList());
        if (!blendshapeFaces.isEmpty()) {
            for (Category category : blendshapeFaces.get(0)) {
                scores.put(category.categoryName(), clamp01(category.score()));
            }
        }
        double blinkLeft = score(scores, "eyeBlinkLeft");
        double blinkRight = score(scores, "eyeBlinkRight");
        double eyeWideLeft = score(scores, "eyeWideLeft");
        double eyeWideRight = score(scores, "eyeWideRight");
        double leftEyeOpen = clamp01(1.0 - blinkLeft + eyeWideLeft * 0.15);
        double rightEyeOpen = clamp01(1.0 - blinkRight + eyeWideRight * 0.15);
        double lookLeft = pair(scores, "eyeLookOutLeft", "eyeLookInRight");
        double lookRight = pair(scores, "eyeLookInLeft", "eyeLookOutRight");
        double lookUp = pair(scores, "eyeLookUpLeft", "eyeLookUpRight");
        double lookDown = pair(scores, "eyeLookDownLeft", "eyeLookDownRight");
        double gazeX = clampSigned(lookRight - lookLeft);
        double gazeY = clampSigned(lookDown - lookUp);
        double gazeConfidence = clamp01(Math.min(leftEyeOpen, rightEyeOpen));
        String gazeDirection;
        if (gazeConfidence < 0.28) gazeDirection = "eyes_closed";
        else if (Math.abs(gazeX) < 0.09 && Math.abs(gazeY) < 0.09) gazeDirection = "center";
        else if (Math.abs(gazeX) >= Math.abs(gazeY)) gazeDirection = gazeX >= 0.0 ? "right" : "left";
        else gazeDirection = gazeY >= 0.0 ? "down" : "up";
        String gazeDirectionZh = "中央";
        if ("left".equals(gazeDirection)) gazeDirectionZh = "左";
        else if ("right".equals(gazeDirection)) gazeDirectionZh = "右";
        else if ("up".equals(gazeDirection)) gazeDirectionZh = "上";
        else if ("down".equals(gazeDirection)) gazeDirectionZh = "下";
        else if ("eyes_closed".equals(gazeDirection)) gazeDirectionZh = "闭眼";
        double jawOpen = score(scores, "jawOpen");
        double smile = pair(scores, "mouthSmileLeft", "mouthSmileRight");
        double asymmetry = clamp01(Math.max(
            Math.abs(score(scores, "mouthSmileLeft") - score(scores, "mouthSmileRight")),
            Math.max(
                Math.abs(blinkLeft - blinkRight),
                Math.abs(score(scores, "mouthStretchLeft") - score(scores, "mouthStretchRight"))
            )
        ));
        double weirdness = clamp01(Math.max(
            Math.max(score(scores, "mouthPucker"), score(scores, "cheekPuff")),
            Math.max(
                Math.max(pair(scores, "mouthStretchLeft", "mouthStretchRight"), pair(scores, "noseSneerLeft", "noseSneerRight")),
                asymmetry
            )
        ));

        JSONObject selected = new JSONObject();
        for (String name : selectedBlendshapes()) selected.put(name, round3(score(scores, name)));
        JSONObject faceBox = faceBox(faces.get(0));
        JSONObject pose = null;
        List<float[]> matrices = result.facialTransformationMatrixes().orElse(Collections.<float[]>emptyList());
        if (!matrices.isEmpty() && matrices.get(0).length >= 11) pose = poseFromMatrix(matrices.get(0));

        return new JSONObject()
            .put("ok", true)
            .put("faceDetected", true)
            .put("faceCount", faces.size())
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
            .put("blendshapes", selected)
            .put("faceBox", faceBox)
            .put("headPose", pose == null ? JSONObject.NULL : pose)
            .toString();
    }

    private String buildGestureJson(GestureRecognizerResult result, long inferenceMs) throws JSONException {
        Category gesture = null;
        if (!result.gestures().isEmpty() && !result.gestures().get(0).isEmpty()) gesture = result.gestures().get(0).get(0);
        if (gesture == null || "None".equals(gesture.categoryName())) {
            return new JSONObject()
                .put("ok", true)
                .put("handDetected", !result.landmarks().isEmpty())
                .put("gesture", "None")
                .put("gestureZh", "未识别")
                .put("confidence", gesture == null ? 0 : round3(gesture.score()))
                .put("inferenceMs", inferenceMs)
                .toString();
        }
        String handedness = "";
        if (!result.handedness().isEmpty() && !result.handedness().get(0).isEmpty()) {
            handedness = result.handedness().get(0).get(0).categoryName();
        }
        JSONArray keyPoints = new JSONArray();
        if (!result.landmarks().isEmpty()) {
            List<NormalizedLandmark> landmarks = result.landmarks().get(0);
            int[] indices = new int[] { 0, 4, 8, 12, 16, 20 };
            for (int index : indices) {
                if (index < landmarks.size()) {
                    NormalizedLandmark point = landmarks.get(index);
                    keyPoints.put(new JSONObject().put("index", index).put("x", round3(point.x())).put("y", round3(point.y())));
                }
            }
        }
        String label = gestureLabels().containsKey(gesture.categoryName()) ? gestureLabels().get(gesture.categoryName()) : gesture.categoryName();
        return new JSONObject()
            .put("ok", true)
            .put("handDetected", true)
            .put("gesture", gesture.categoryName())
            .put("gestureZh", label)
            .put("confidence", round3(gesture.score()))
            .put("handedness", handedness)
            .put("keyPoints", keyPoints)
            .put("inferenceMs", inferenceMs)
            .toString();
    }

    private Bitmap decodeFrame(String rawFrame) throws FrameInputException {
        String raw = rawFrame == null ? "" : rawFrame;
        if (raw.length() < MIN_FRAME_CHARS || raw.length() > MAX_FRAME_CHARS) throw new FrameInputException("frame_size", "摄像头画面大小不合规");
        int comma = raw.indexOf(',');
        if (comma <= 0) throw new FrameInputException("frame_format", "摄像头画面格式不正确");
        String prefix = raw.substring(0, comma).toLowerCase(Locale.ROOT);
        if (!("data:image/jpeg;base64".equals(prefix) || "data:image/jpg;base64".equals(prefix) || "data:image/png;base64".equals(prefix))) {
            throw new FrameInputException("frame_type", "仅支持 JPEG 或 PNG 画面");
        }
        byte[] bytes;
        try { bytes = Base64.decode(raw.substring(comma + 1), Base64.DEFAULT); }
        catch (IllegalArgumentException error) { throw new FrameInputException("frame_base64", "摄像头画面无法解码"); }
        if (bytes.length < MIN_FRAME_BYTES || bytes.length > MAX_FRAME_BYTES) throw new FrameInputException("frame_bytes", "摄像头画面大小不合规");

        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth > MAX_SOURCE_EDGE || bounds.outHeight > MAX_SOURCE_EDGE) {
            throw new FrameInputException("frame_dimensions", "摄像头画面尺寸不合规");
        }
        int sampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sampleSize > MAX_FRAME_EDGE * 2) sampleSize *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (decoded == null) throw new FrameInputException("frame_decode", "摄像头画面无法读取");
        if (Math.max(decoded.getWidth(), decoded.getHeight()) <= MAX_FRAME_EDGE) return decoded;
        float scale = (float) MAX_FRAME_EDGE / (float) Math.max(decoded.getWidth(), decoded.getHeight());
        Bitmap scaled = Bitmap.createScaledBitmap(decoded, Math.max(1, (int) (decoded.getWidth() * scale)), Math.max(1, (int) (decoded.getHeight() * scale)), true);
        if (scaled != decoded) decoded.recycle();
        return scaled;
    }

    private JSONObject faceBox(List<NormalizedLandmark> landmarks) throws JSONException {
        float minX = 1f, minY = 1f, maxX = 0f, maxY = 0f;
        for (NormalizedLandmark point : landmarks) {
            minX = Math.min(minX, point.x()); minY = Math.min(minY, point.y());
            maxX = Math.max(maxX, point.x()); maxY = Math.max(maxY, point.y());
        }
        return new JSONObject().put("x", round3(minX)).put("y", round3(minY))
            .put("width", round3(maxX - minX)).put("height", round3(maxY - minY));
    }

    private JSONObject poseFromMatrix(float[] matrix) throws JSONException {
        double r00 = matrix[0], r10 = matrix[4], r20 = matrix[8], r21 = matrix[9], r22 = matrix[10];
        double pitch = Math.atan2(-r20, Math.sqrt(r00 * r00 + r10 * r10)) * 57.29577951308232;
        double yaw = Math.atan2(r21, r22) * 57.29577951308232;
        double roll = Math.atan2(r10, r00) * 57.29577951308232;
        return new JSONObject().put("yaw", round2(yaw)).put("pitch", round2(pitch)).put("roll", round2(roll));
    }

    private String cached(long now, long lastAt, String json) {
        if (json == null || now - lastAt >= MIN_INTERVAL_MS) return null;
        try { return new JSONObject(json).put("cached", true).toString(); }
        catch (Throwable ignored) { return json; }
    }

    private boolean assetExists(String path) {
        try { context.getAssets().open(path).close(); return true; }
        catch (Throwable ignored) { return false; }
    }

    private static double score(Map<String, Double> scores, String name) { Double value = scores.get(name); return value == null ? 0.0 : value; }
    private static double pair(Map<String, Double> scores, String left, String right) { return (score(scores, left) + score(scores, right)) / 2.0; }
    private static double clamp01(double value) { return Math.max(0.0, Math.min(1.0, value)); }
    private static double clampSigned(double value) { return Math.max(-1.0, Math.min(1.0, value)); }
    private static double round2(double value) { return Math.round(value * 100.0) / 100.0; }
    private static double round3(double value) { return Math.round(value * 1000.0) / 1000.0; }
    private static String valueOr(String value, String fallback) { return value == null || value.trim().length() == 0 ? fallback : value; }
    private static String safeMessage(Throwable error, String fallback) { return valueOr(error == null ? null : error.getMessage(), fallback); }
    private static String error(String code, String message) {
        try {
            return new JSONObject().put("ok", false).put("error", code).put("message", valueOr(message, "识别失败")).toString();
        } catch (JSONException ignored) {
            return "{\"ok\":false,\"error\":\"native_error\"}";
        }
    }

    private static List<String> selectedBlendshapes() {
        List<String> values = new ArrayList<String>();
        Collections.addAll(values, "eyeBlinkLeft", "eyeBlinkRight", "eyeWideLeft", "eyeWideRight", "eyeSquintLeft", "eyeSquintRight",
            "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
            "jawOpen", "mouthSmileLeft", "mouthSmileRight", "mouthPucker", "mouthStretchLeft", "mouthStretchRight", "cheekPuff", "noseSneerLeft", "noseSneerRight");
        return values;
    }

    private static Map<String, String> gestureLabels() {
        Map<String, String> values = new LinkedHashMap<String, String>();
        values.put("Closed_Fist", "石头"); values.put("Open_Palm", "布"); values.put("Victory", "剪刀");
        values.put("Pointing_Up", "向上指"); values.put("Thumb_Up", "点赞"); values.put("Thumb_Down", "倒赞"); values.put("ILoveYou", "我爱你");
        return values;
    }

    private static final class FrameInputException extends Exception {
        final String code;
        FrameInputException(String code, String message) { super(message); this.code = code; }
    }
}
