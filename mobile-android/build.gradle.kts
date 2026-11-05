plugins {
    // Same versions as the Fire TV app (tv-android/). AGP 9 compiles Kotlin itself
    // (built-in Kotlin); declaring the Kotlin plugin here only pins its version.
    id("com.android.application") version "9.5.0" apply false
    id("org.jetbrains.kotlin.android") version "2.4.21" apply false
}
