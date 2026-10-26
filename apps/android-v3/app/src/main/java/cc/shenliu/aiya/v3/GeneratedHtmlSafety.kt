package cc.shenliu.aiya.v3

/** Pure checks, shared by preview preparation and JVM crash regressions. */
internal fun enforceGeneratedHtmlSafety(html: String) {
    if (html.length < 40 || html.length > 800 * 1024) {
        throw IllegalStateException("生成作品太小或太大，请重试。")
    }
    val head = html.take(512).lowercase()
    if (!head.contains("<!doctype html") && !head.contains("<html")) {
        throw IllegalStateException("生成作品不是有效的 HTML，请重试。")
    }

    // SVG namespace identifiers are not resource requests. Exempt only these
    // exact attributes on SVG opening tags, not the same URLs in src/fetch/CSS.
    val svgTag = Regex("<svg\\b[^>]*>", RegexOption.IGNORE_CASE)
    val namespace = Regex(
        """\s+xmlns\s*=\s*(["'])http://www\.w3\.org/2000/svg\1(?=\s|/?>)""",
        RegexOption.IGNORE_CASE,
    )
    val xlinkNamespace = Regex(
        """\s+xmlns:xlink\s*=\s*(["'])http://www\.w3\.org/1999/xlink\1(?=\s|/?>)""",
        RegexOption.IGNORE_CASE,
    )
    val inspectedHtml = svgTag.replace(html) { tag ->
        xlinkNamespace.replace(namespace.replace(tag.value, ""), "")
    }
    val forbidden = listOf(
        Regex("<script\\b[^>]*\\bsrc\\s*=", RegexOption.IGNORE_CASE),
        Regex("<link\\b[^>]*\\bhref\\s*=", RegexOption.IGNORE_CASE),
        Regex("<iframe\\b[^>]*\\bsrc\\s*=", RegexOption.IGNORE_CASE),
        Regex("\\b(?:https?:)?//", RegexOption.IGNORE_CASE),
        Regex("""["'(=]\s*//[A-Za-z0-9]""", RegexOption.IGNORE_CASE),
        Regex("\\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\\s*\\(", RegexOption.IGNORE_CASE),
        Regex("\\b(?:localStorage|sessionStorage|indexedDB|document\\.cookie)\\b", RegexOption.IGNORE_CASE),
    )
    if (forbidden.any { it.containsMatchIn(inspectedHtml) }) {
        throw IllegalStateException("生成作品包含被禁用的资源或网络调用，请重试。")
    }
}

/** Reject unsafe works before creating a WebView; never let rejection kill Compose. */
internal fun prepareGeneratedPreview(html: String, prepareHtml: (String) -> String): Result<String> =
    runCatching {
        enforceGeneratedHtmlSafety(html)
        prepareHtml(html)
    }
