/**
 * Simple Rate Limiter
 * Prevents too many requests in a short time
 */

class RateLimiter {
  constructor(maxRequests = 3, windowMs = 60000) {
    this.maxRequests = maxRequests;  // Max requests
    this.windowMs = windowMs;        // Time window in ms
    this.requests = [];
  }

  canMakeRequest() {
    const now = Date.now();
    
    // Remove old requests outside the time window
    this.requests = this.requests.filter(
      time => now - time < this.windowMs
    );
    
    // Check if under limit
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }
    
    return false;
  }

  getTimeUntilNextRequest() {
    if (this.requests.length === 0) return 0;
    
    const oldestRequest = Math.min(...this.requests);
    const timeElapsed = Date.now() - oldestRequest;
    const timeRemaining = this.windowMs - timeElapsed;
    
    return Math.max(0, Math.ceil(timeRemaining / 1000));
  }
}

// Export for use in server
export default RateLimiter;