package cc.shenliu.aiya.v3

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AiyaBodyVisionEngineInstrumentedTest {
    @Test
    fun recognizesFaceAndThumbUpLocally() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val engine = AiyaBodyVisionEngine(instrumentation.targetContext)
        try {
            val capabilities = JSONObject(engine.capabilities())
            assertTrue(capabilities.getBoolean("localOnly"))
            assertTrue(capabilities.getBoolean("face"))
            assertTrue(capabilities.getBoolean("gesture"))
            assertTrue(capabilities.getBoolean("gaze"))

            val face = JSONObject(engine.analyzeFace(testAssetDataUrl("face.jpg")))
            assertTrue(face.toString(), face.getBoolean("ok"))
            assertTrue(face.toString(), face.getBoolean("faceDetected"))
            assertEquals(1, face.getInt("faceCount"))
            assertTrue(face.has("leftEyeOpen"))
            assertTrue(face.has("rightEyeOpen"))
            assertTrue(face.has("mouthOpenScore"))
            assertTrue(face.has("weirdnessScore"))
            assertTrue(face.has("gazeX"))
            assertTrue(face.has("gazeY"))
            assertTrue(face.has("gazeDirection"))

            val gesture = JSONObject(engine.analyzeGesture(testAssetDataUrl("hand_thumb_up.jpg")))
            assertTrue(gesture.toString(), gesture.getBoolean("ok"))
            assertTrue(gesture.toString(), gesture.getBoolean("handDetected"))
            assertEquals("Thumb_Up", gesture.getString("gesture"))
            assertTrue(gesture.toString(), gesture.getDouble("confidence") >= 0.5)
        } finally {
            engine.close()
        }
    }

    private fun testAssetDataUrl(name: String): String {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val bytes = assets.open(name).use { it.readBytes() }
        return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
}
