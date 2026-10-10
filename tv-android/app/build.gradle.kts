import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
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
    compileSdk = 34

    defaultConfig {
        applicationId = "com.binge.tv"
        minSdk = 22 // Fire OS 5 (oldest Fire TV sticks still in use)
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
    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf(
            "-opt-in=androidx.compose.ui.ExperimentalComposeUiApi",
            "-opt-in=androidx.compose.foundation.ExperimentalFoundationApi",
            "-opt-in=androidx.tv.material3.ExperimentalTvMaterial3Api",
        )
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.tv:tv-material:1.0.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.google.zxing:core:3.5.3")
}
