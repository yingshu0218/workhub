package `fun`.fpigeon.nexus

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Android 15+（targetSdk 35 起）强制 edge-to-edge，WebView 会铺到状态栏与手势条下面。
    // 前端 CSS 的 env(safe-area-inset-*) 在 Android WebView 里并不可靠，所以在原生侧把系统栏
    // 与刘海的内边距直接加在内容根 View 上：顶栏与底部 Tab 不会被遮挡，也不必在前端写平台分支。
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }
}
