package com.binge.tv.data

import kotlinx.serialization.Serializable

// Profile PINs (Supabase profile_locks + RPCs, same as the website's
// utils/profileLocks.js and the Apple TV app). The PIN is checked on the
// server; the app only learns which profiles are locked and whether a PIN
// was right.
object ProfileLocks {
    const val PIN_LENGTH = 4

    @Serializable private data class Row(val profileId: String)

    /** IDs of this account's locked profiles. PINs not installed on the server
     *  (no function and no table) means no locks; any other failure throws, so
     *  a locked profile is never opened by mistake. */
    suspend fun lockedIds(): Set<String> {
        try {
            val body = Supabase.rpc("list_profile_locks", emptyMap(), Supabase.Auth.REQUIRED)
            return json.decodeFromString<List<Row>>(body).map { it.profileId }.toSet()
        } catch (e: BingeException) {
            if (e.status != 404) throw e
            try {
                Supabase.select("profile_locks", listOf("select" to "profile_id", "limit" to "0"))
            } catch (missing: BingeException) {
                if (missing.status == 404) return emptySet()
            }
            throw e
        }
    }

    /** True when the PIN is right. Five wrong tries lock the profile for five
     *  minutes (the server then answers false). */
    suspend fun verify(profileId: String, pin: String): Boolean =
        Supabase.rpc("verify_profile_pin", mapOf("target_profile" to profileId, "entered_pin" to pin), Supabase.Auth.REQUIRED).trim() == "true"
}
