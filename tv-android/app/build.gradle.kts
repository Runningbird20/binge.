import java.io.File
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    // AGP 9 has Kotlin built in: no org.jetbrains.kotlin.android here.
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Same public keys the website uses (Supabase publishable key, TMDB key),
// read from the repo's .env, or from Gradle properties / environment
// variables on CI. Nothing secret: these already ship in the website.
val envFile = File(rootDir, "../.env")
val dotenv: Map<String, String> = if (envFile.exists()) envFile.readLines()
    .mapNotNull { line -> line.trim().takeIf { it.isNotEmpty() && !it.startsWith("#") && it.contains("=") } }
    .associate { it.substringBefore("=").trim() to it.substringAfter("=").trim().trim('"', '\'') }
    else emptyMap()

fun setting(vararg names: String): String = names.firstNotNullOfOrNull { name ->
    (project.findProperty(name) as String?) ?: System.getenv(name) ?: dotenv[name]
}?.takeIf { it.isNotBlank() } ?: ""

val bingeUrl = setting("binge.url", "BINGE_URL").ifEmpty { "https://binge-26.vercel.app" }
val supabaseUrl = setting("REACT_APP_SUPABASE_URL")
val supabaseKey = setting("REACT_APP_SUPABASE_PUBLISHABLE_KEY", "REACT_APP_SUPABASE_ANON_KEY")
val tmdbKey = setting("REACT_APP_TMDB_API_KEY")

android {
    namespace = "com.binge.tv"
    compileSdk = 37 // Compose 1.12 and OkHttp 5.5 require it; minSdk/targetSdk are separate

    defaultConfig {
        applicationId = "com.binge.tv"
        minSdk = 23 // Compose 1.12 / tv-material 1.1 need it: Fire OS 6+ (Fire OS 5 sticks dropped 2026-11)
        targetSdk = 34
        versionCode = 2
        versionName = "2.0"
        buildConfigField("String", "BINGE_URL", "\"$bingeUrl\"")
        buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
        buildConfigField("String", "SUPABASE_KEY", "\"$supabaseKey\"")
        buildConfigField("String", "TMDB_KEY", "\"$tmdbKey\"")
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with this machine's debug key, the same key as earlier
            // installs, so a new APK installs over the old one (sideload only).
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        optIn.addAll(
            "androidx.compose.ui.ExperimentalComposeUiApi",
            "androidx.compose.foundation.ExperimentalFoundationApi",
            "androidx.tv.material3.ExperimentalTvMaterial3Api",
        )
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.tv:tv-material:1.1.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:5.5.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
}
