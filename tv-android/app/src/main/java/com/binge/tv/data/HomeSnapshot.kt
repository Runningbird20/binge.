package com.binge.tv.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

// The last Home screen, per profile, on disk: the app opens straight onto
// it (no skeletons while a slow stick waits on the network) and Home then
// refreshes everything in the background. Only catalog/TMDB data and this
// profile's own rows, in the app's private files; a week old at most.
@Serializable
data class HomeSnapshot(
    val savedAt: Long,
    val continueItems: List<ContinueItem> = emptyList(),
    val myList: List<Title> = emptyList(),
    val personal: Personal.Rows = Personal.Rows(),
    val shared: List<Title> = emptyList(),
    val rows: List<LoadedRow> = emptyList(),
) {
    companion object {
        private const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
        private val format = Json { ignoreUnknownKeys = true; encodeDefaults = false }
        private lateinit var dir: File

        fun init(context: Context) { dir = context.filesDir.resolve("home") }

        private fun file(profileId: String, kids: Boolean) = File(dir, "${profileId.filter { it.isLetterOrDigit() || it == '-' }}${if (kids) "-kids" else ""}.json")

        suspend fun read(profileId: String?, kids: Boolean): HomeSnapshot? = withContext(Dispatchers.IO) {
            if (profileId == null || !::dir.isInitialized) return@withContext null
            runCatching { format.decodeFromString<HomeSnapshot>(file(profileId, kids).readText()) }.getOrNull()
                ?.takeIf { System.currentTimeMillis() - it.savedAt < MAX_AGE_MS && it.rows.isNotEmpty() }
        }

        suspend fun write(profileId: String?, kids: Boolean, snapshot: HomeSnapshot) = withContext(Dispatchers.IO) {
            if (profileId == null || !::dir.isInitialized) return@withContext
            runCatching {
                dir.mkdirs()
                val target = file(profileId, kids)
                val temp = File(dir, target.name + ".tmp")
                temp.writeText(format.encodeToString(snapshot))
                temp.renameTo(target)
            }
        }

        // Signing out leaves nothing of the account behind.
        fun clear() { if (::dir.isInitialized) runCatching { dir.deleteRecursively() } }
    }
}
