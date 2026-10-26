package cc.shenliu.aiya.v3

import org.junit.Assert.*
import org.junit.Test

class GeneratedHtmlSafetyTest {
    private fun document(body: String) = "<!doctype html><html><head><title>测试</title></head><body>$body</body></html>"

    @Test fun rabbitSvgNamespacesAreNotNetworkRequests() {
        val html = document("""<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink='http://www.w3.org/1999/xlink' viewBox="0 0 140 160"><ellipse cx="48" cy="38" rx="14" ry="38"/></svg>""")
        val result = prepareGeneratedPreview(html) { it }
        assertTrue(result.isSuccess)
        assertEquals(html, result.getOrThrow()) // Do not alter the actual SVG.
    }

    @Test fun acceptsAttributeSpacingCaseAndMultipleSvgElements() {
        enforceGeneratedHtmlSafety(document("""<SVG XMLNS = 'http://www.w3.org/2000/svg' /><svg xmlns="http://www.w3.org/2000/svg"></svg>"""))
        enforceGeneratedHtmlSafety(document("<script>\n// A normal code comment must remain allowed.\nconst n = 1;\n</script>"))
    }

    @Test fun preservesEveryExistingResourceAndNetworkRestriction() {
        val forbidden = listOf(
            """<script src="local.js"></script>""",
            """<link href="local.css">""",
            """<iframe src="local.html"></iframe>""",
            """<img src="https://example.test/a.png">""",
            """<img src="//example.test/a.png">""",
            """<script>fetch('/api')</script>""",
            """<script>new XMLHttpRequest()</script>""",
            """<script>new WebSocket('/socket')</script>""",
            """<script>new EventSource('/events')</script>""",
            """<script>navigator.sendBeacon('/log')</script>""",
            """<script>localStorage.setItem('a','b')</script>""",
            """<script>sessionStorage.clear()</script>""",
            """<script>indexedDB.open('a')</script>""",
            """<script>document.cookie</script>""",
        )
        forbidden.forEach { body ->
            var prepared = false
            val result = prepareGeneratedPreview(document(body)) { prepared = true; it }
            assertTrue(body, result.isFailure)
            assertFalse("Rejected content must not reach WebView preparation: $body", prepared)
        }
    }

    @Test fun namespaceExceptionCannotAllowAnActualUrlRequest() {
        listOf(
            """<svg xmlns="http://www.w3.org/2000/svg"><image href="http://www.w3.org/2000/svg"/></svg>""",
            """<svg xmlns="http://www.w3.org/2000/svg" style="background:url(http://example.test/x)"></svg>""",
            """<svg xmlns="https://example.test/namespace"></svg>""",
            """<svg xmlns="http://www.w3.org/2000/svg/evil"></svg>""",
            """<script>fetch('http://www.w3.org/2000/svg')</script>""",
        ).forEach { assertTrue(it, prepareGeneratedPreview(document(it)) { source -> source }.isFailure) }
    }

    @Test fun malformedAndOversizeWorksFailWithoutThrowingIntoUi() {
        listOf("", "not an HTML document".repeat(3), document("x".repeat(800 * 1024))).forEach {
            assertTrue(prepareGeneratedPreview(it) { source -> source }.isFailure)
        }
    }

    @Test fun unexpectedPreparationFailureDoesNotEscapeAndNextWorkCanLoad() {
        val html = document("<button>你好</button>")
        assertTrue(prepareGeneratedPreview(html) { throw IllegalStateException("preparation failure") }.isFailure)
        assertTrue(prepareGeneratedPreview(html) { it }.isSuccess)
    }
}
