package io.catalyst.nativeai

import java.io.File

/** Files an earlier version stored a model under. They are removed after the current file has been downloaded, never before. */
internal object LegacyModelFiles {
    private val SUFFIXES = listOf("", ".tmp", ".tmp.etag")

    /** Deletes each legacy file and its temporary download files from [dir]. Returns the names that were removed. */
    fun remove(dir: File, legacyNames: List<String>): List<String> {
        val removed = mutableListOf<String>()
        for (name in legacyNames) {
            for (suffix in SUFFIXES) {
                val file = File(dir, name + suffix)
                // A name that is not a plain file name (a path) is never followed out of the models directory.
                if (File(name).name != name) continue
                if (file.isFile && file.delete()) removed += name + suffix
            }
        }
        return removed
    }
}
