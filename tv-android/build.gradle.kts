plugins {
    id("com.android.application") version "9.5.0" apply false
    // AGP 9 compiles Kotlin itself (built-in Kotlin), so the app doesn't apply
    // this plugin; declaring it here only pins the Kotlin version AGP uses.
    // Keep it equal to the Compose and serialization plugins below.
    id("org.jetbrains.kotlin.android") version "2.4.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.4.21" apply false
}
