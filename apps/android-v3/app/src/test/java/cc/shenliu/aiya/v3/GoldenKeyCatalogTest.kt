package cc.shenliu.aiya.v3

import java.io.File
import org.junit.Assert.*
import org.junit.Test

class GoldenKeyCatalogTest {
    private fun catalog() = parseGoldenKeyCatalog(File("src/main/assets/golden-key.json").readText())
    @Test fun sixDistinctDirectionsWithHonestChecks() {
        val examples=catalog()
        assertEquals(6,examples.size)
        assertEquals(6,examples.map { it.id }.distinct().size)
        assertEquals(6,examples.map { it.category }.distinct().size)
        examples.forEach { e ->
            assertTrue(e.title.length<=5); assertTrue(e.prompt.length in 600..2400)
            assertTrue(e.checks.size>=3);assertTrue(e.nextStep.isNotBlank())
            assertTrue(e.prompt.contains("正文至少18px"));assertTrue(e.prompt.contains("不使用 localStorage"))
        }
    }
    @Test fun deviceAndPersistenceLimitsAreVisible() {
        val examples=catalog()
        assertTrue(examples.first { it.id=="gravity-maze" }.requirements.contains("实机"))
        assertTrue(examples.first { it.id=="sound-garden" }.requirements.contains("本机"))
        assertTrue(examples.first { it.id=="purchase-helper" }.requirements.contains("不自动存档"))
        assertTrue(examples.first { it.id=="focus-forest" }.requirements.contains("后台暂停"))
    }
    @Test fun drawingIntentOnlyInDrawingSample() {
        catalog().forEach { e ->
            if (e.id!="light-drawing") assertFalse(Regex("画板|画笔|绘画|canvas",RegexOption.IGNORE_CASE).containsMatchIn(e.prompt))
        }
    }
    @Test fun unsupportedSchemaRejected() {
        try { parseGoldenKeyCatalog("{\"schemaVersion\":2}");fail("must reject") }
        catch (_:IllegalArgumentException) { }
    }
}
