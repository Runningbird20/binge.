# The page bridge calls these from JavaScript by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
# Kept readable in crash reports.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
