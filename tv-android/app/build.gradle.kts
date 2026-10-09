plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val bingeUrl: String = (project.findProperty("binge.url") as String?) ?: "https://binge-26.vercel.app"

android {
    namespace = "com.binge.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.binge.tv"
        minSdk = 22 // Fire OS 5 (oldest Fire TV sticks still in use)
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "BINGE_URL", "\"$bingeUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
