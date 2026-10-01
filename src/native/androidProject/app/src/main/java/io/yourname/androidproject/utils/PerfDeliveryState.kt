package io.yourname.androidproject.utils

internal class PerfDeliveryState<T> {
    data class Batch<T>(val id: String, val payload: T, val generation: Long, val retryCount: Int = 0)

    private var generation = 0L
    private var sequence = 0L
    private var inFlight: Batch<T>? = null

    fun hasInFlight(): Boolean = inFlight != null

    fun current(): Batch<T>? = inFlight

    fun begin(payload: T): Batch<T>? {
        if (inFlight != null) return null
        return Batch("catalyst-${++sequence}", payload, generation).also { inFlight = it }
    }

    fun isCurrent(batch: Batch<T>): Boolean = inFlight?.id == batch.id && batch.generation == generation

    fun acknowledge(batch: Batch<T>): Boolean {
        if (!isCurrent(batch)) return false
        inFlight = null
        return true
    }

    fun retry(batch: Batch<T>, maxRetries: Int): Batch<T>? {
        if (!isCurrent(batch) || batch.retryCount >= maxRetries) return null
        return batch.copy(retryCount = batch.retryCount + 1).also { inFlight = it }
    }

    fun reset() {
        generation++
        inFlight = null
    }
}
