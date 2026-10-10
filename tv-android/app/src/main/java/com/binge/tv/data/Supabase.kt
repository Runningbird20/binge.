package com.binge.tv.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
data class AuthSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: Long, // epoch ms
    val userId: String,
    val email: String? = null,
)

// Any → JSON for request bodies (Map, List, String, Number, Boolean, null).
fun toJson(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to toJson(v) })
    is Iterable<*> -> JsonArray(value.map { toJson(it) })
    else -> JsonPrimitive(value.toString())
}

// Same Supabase project the website uses: GoTrue for sign-in, PostgREST for
// data, protected by the same RLS policies. No SDK, just HTTP.
object Supabase {
    enum class Auth { REQUIRED, OPTIONAL }

    private lateinit var prefs: SharedPreferences
    var session: AuthSession? = null
        private set
    private val refreshLock = Mutex()

    fun init(context: Context) {
        prefs = context.getSharedPreferences("binge.auth", Context.MODE_PRIVATE)
        session = prefs.getString("session", null)?.let { runCatching { plainJson.decodeFromString<AuthSession>(it) }.getOrNull() }
    }

    private fun save(value: AuthSession?) {
        session = value
        prefs.edit().apply { if (value == null) remove("session") else putString("session", plainJson.encodeToString(AuthSession.serializer(), value)) }.apply()
    }

    suspend fun signIn(email: String, password: String): AuthSession =
        tokenRequest("password", mapOf("email" to email, "password" to password))

    suspend fun signOut() {
        val token = session?.accessToken
        if (token != null && Config.isConfigured) {
            runCatching {
                Net.send(Request.Builder().url("${Config.supabaseUrl}/auth/v1/logout")
                    .header("apikey", Config.supabaseKey).header("Authorization", "Bearer $token")
                    .post("".toRequestBody()).build())
            }
        }
        save(null)
    }

    private suspend fun tokenRequest(grant: String, body: Map<String, String>): AuthSession {
        if (!Config.isConfigured) throw BingeException("This build is missing its settings. Build it from the repo with .env present.")
        val request = Request.Builder()
            .url("${Config.supabaseUrl}/auth/v1/token?grant_type=$grant")
            .header("apikey", Config.supabaseKey)
            .post(toJson(body).toString().toRequestBody(JSON))
            .build()
        val reply = Net.send(request)
        if (reply.status !in 200..299) throw BingeException(message(reply.body, reply.status), reply.status)
        val root = plainJson.parseToJsonElement(reply.body).jsonObject
        val user = root["user"]!!.jsonObject
        val fresh = AuthSession(
            accessToken = root["access_token"]!!.jsonPrimitive.content,
            refreshToken = root["refresh_token"]!!.jsonPrimitive.content,
            expiresAt = System.currentTimeMillis() + (root["expires_in"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: 3600.0).toLong() * 1000,
            userId = user["id"]!!.jsonPrimitive.content,
            email = user["email"]?.jsonPrimitive?.contentOrNull,
        )
        save(fresh)
        return fresh
    }

    // A session good for at least another minute. Concurrent callers share one refresh.
    suspend fun validSession(): AuthSession {
        val current = session ?: throw SignedOutException()
        if (current.expiresAt - System.currentTimeMillis() > 60_000) return current
        return refreshLock.withLock {
            val again = session ?: throw SignedOutException()
            if (again.expiresAt - System.currentTimeMillis() > 60_000) return@withLock again
            try {
                tokenRequest("refresh_token", mapOf("refresh_token" to again.refreshToken))
            } catch (e: BingeException) {
                if (e.status in 400..499) { save(null); throw SignedOutException() }
                throw e
            }
        }
    }

    // MARK: PostgREST

    suspend fun select(table: String, query: List<Pair<String, String>>, auth: Auth = Auth.REQUIRED): String =
        send("GET", table, query, null, auth)

    suspend inline fun <reified T> selectAs(table: String, query: List<Pair<String, String>>, auth: Auth = Auth.REQUIRED): T =
        json.decodeFromString(select(table, query, auth))

    suspend fun insert(table: String, row: Map<String, Any?>) {
        send("POST", table, emptyList(), row, Auth.REQUIRED, "return=minimal")
    }

    suspend fun upsert(table: String, onConflict: String, row: Map<String, Any?>) {
        send("POST", table, listOf("on_conflict" to onConflict), row, Auth.REQUIRED, "resolution=merge-duplicates,return=minimal")
    }

    suspend fun rpc(name: String, params: Map<String, Any?>, auth: Auth = Auth.OPTIONAL): String =
        send("POST", "rpc/$name", emptyList(), params, auth)

    suspend fun update(table: String, query: List<Pair<String, String>>, row: Map<String, Any?>) {
        send("PATCH", table, query, row, Auth.REQUIRED, "return=minimal")
    }

    suspend fun delete(table: String, query: List<Pair<String, String>>) {
        send("DELETE", table, query, null, Auth.REQUIRED)
    }

    private suspend fun send(method: String, table: String, query: List<Pair<String, String>>, body: Any?, auth: Auth, prefer: String? = null): String {
        if (!Config.isConfigured) throw BingeException("This build is missing its settings.")
        val url = "${Config.supabaseUrl}/rest/v1/$table".toHttpUrl().newBuilder().apply {
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        val builder = Request.Builder().url(url).header("apikey", Config.supabaseKey)
        when (auth) {
            Auth.REQUIRED -> builder.header("Authorization", "Bearer ${validSession().accessToken}")
            Auth.OPTIONAL -> runCatching { validSession() }.getOrNull()?.let { builder.header("Authorization", "Bearer ${it.accessToken}") }
        }
        prefer?.let { builder.header("Prefer", it) }
        val requestBody = body?.let { toJson(it).toString().toRequestBody(JSON) }
        builder.method(method, requestBody ?: if (method == "GET" || method == "DELETE") null else "".toRequestBody(JSON))
        val reply = Net.send(builder.build())
        if (reply.status == 401 && auth == Auth.REQUIRED) { save(null); throw SignedOutException() }
        if (reply.status !in 200..299) throw BingeException(message(reply.body, reply.status), reply.status)
        return reply.body
    }

    private val JSON = "application/json".toMediaType()

    private fun message(body: String, status: Int): String {
        val root = runCatching { plainJson.parseToJsonElement(body).jsonObject }.getOrNull()
        fun field(name: String) = root?.get(name)?.let { (it as? JsonPrimitive)?.contentOrNull }
        val code = field("error_code") ?: field("error")
        if (code == "invalid_credentials" || code == "invalid_grant") return "That email and password don't match a binge. account."
        if (code == "email_not_confirmed") return "Confirm your email first. Check your inbox for the link from binge."
        val text = field("msg") ?: field("message") ?: field("error_description")
        if (!text.isNullOrEmpty()) return text
        return if (status >= 500) "binge. is having trouble right now. Try again in a moment." else "Something went wrong ($status)."
    }
}
