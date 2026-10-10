package com.binge.tv.data

import com.binge.tv.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

// Build-time settings: the same public keys the website ships (see
// app/build.gradle.kts, read from the repo's .env).
object Config {
    val supabaseUrl: String = BuildConfig.SUPABASE_URL.trimEnd('/')
    val supabaseKey: String = BuildConfig.SUPABASE_KEY
    val tmdbKey: String = BuildConfig.TMDB_KEY
    val siteUrl: String = BuildConfig.BINGE_URL.trimEnd('/')
    val siteHost: String = siteUrl.substringAfter("://").substringBefore('/')
    val isConfigured: Boolean get() = supabaseUrl.startsWith("http") && supabaseKey.isNotEmpty() && tmdbKey.isNotEmpty()
}

class BingeException(message: String, val status: Int = 0) : Exception(message)
class SignedOutException : Exception("You've been signed out. Sign in again to continue.")

@OptIn(ExperimentalSerializationApi::class)
val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
    namingStrategy = JsonNamingStrategy.SnakeCase
}

// Plain keys (no snake_case mapping), for hand-built JSON.
val plainJson = Json { ignoreUnknownKeys = true; isLenient = true }

object Net {
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    class Reply(val status: Int, val body: String)

    suspend fun send(request: Request): Reply = withContext(Dispatchers.IO) {
        suspendCancellableCoroutine { cont ->
            val call = client.newCall(request)
            cont.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWithException(e) }
                override fun onResponse(call: Call, response: Response) {
                    val reply = response.use { Reply(it.code, it.body?.string() ?: "") }
                    if (cont.isActive) cont.resume(reply)
                }
            })
        }
    }

    suspend fun get(url: String, headers: Map<String, String> = emptyMap()): Reply {
        val builder = Request.Builder().url(url)
        headers.forEach { (k, v) -> builder.header(k, v) }
        return send(builder.build())
    }

    // The body of a 200 response, or null on any failure.
    suspend fun text(url: String, headers: Map<String, String> = emptyMap()): String? =
        runCatching { get(url, headers) }.getOrNull()?.takeIf { it.status == 200 }?.body
}
