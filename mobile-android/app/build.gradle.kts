import java.net.URI
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    // AGP 9 has Kotlin built in: no org.jetbrains.kotlin.android here.
    id("com.android.application")
}

val bingeUrl = ((project.findProperty("binge.url") as String?) ?: System.getenv("BINGE_URL") ?: "")
    .ifBlank { "https://binge-26.vercel.app" }.trimEnd('/')

android {
    namespace = "com.binge.mobile"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.binge.mobile"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "BINGE_URL", "\"$bingeUrl\"")
        // Links to the site open in the app (Settings › Open by default › Open supported links).
        manifestPlaceholders["bingeHost"] = URI(bingeUrl).host
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with this machine's debug key, like the Fire TV APK, so a new
            // build installs over the old one (sideload only, not the Play Store).
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
    }
}

dependencies {
    // Web messages and document-start scripts limited to the site's own pages,
    // and dropping the X-Requested-With header (same version as the Fire TV app).
    implementation("androidx.webkit:webkit:1.12.1")
}
