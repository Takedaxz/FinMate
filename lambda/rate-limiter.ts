/**
 * Simple in-memory rate limiter for Bedrock Agent invocations
 * Prevents hitting Bedrock quotas by spacing out requests
 */

interface RateLimitConfig {
  maxRequestsPerMinute: number;
  burstSize: number;
}

class BedrockRateLimiter {
  private requestTimestamps: number[] = [];
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = { maxRequestsPerMinute: 20, burstSize: 5 }) {
    this.config = config;
  }

  /**
   * Check if we can make a request now
   * Returns: { allowed: boolean, waitMs: number }
   */
  async checkAndWait(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);

    // Check if we're at quota
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      // Calculate how long to wait
      const oldestTimestamp = this.requestTimestamps[0];
      const waitMs = oldestTimestamp + 60000 - now + 1000; // Add 1 second buffer
      
      console.log(`Rate limit reached. Waiting ${waitMs}ms before next request...`);
      await this.sleep(waitMs);
      
      // Recursive call after waiting
      return this.checkAndWait();
    }

    // Check burst limit (max N requests in quick succession)
    const recentRequests = this.requestTimestamps.filter(ts => ts > now - 10000); // Last 10 seconds
    if (recentRequests.length >= this.config.burstSize) {
      const waitMs = 2000; // Wait 2 seconds between bursts
      console.log(`Burst limit reached. Spacing requests by ${waitMs}ms...`);
      await this.sleep(waitMs);
    }

    // Record this request
    this.requestTimestamps.push(Date.now());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current usage stats
   */
  getStats() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentRequests = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    
    return {
      requestsInLastMinute: recentRequests.length,
      quotaUsagePercent: (recentRequests.length / this.config.maxRequestsPerMinute) * 100,
      remainingQuota: this.config.maxRequestsPerMinute - recentRequests.length,
    };
  }

  /**
   * Reset the limiter (useful for testing)
   */
  reset() {
    this.requestTimestamps = [];
  }
}

// Singleton instance (shared across Lambda invocations in same container)
let rateLimiterInstance: BedrockRateLimiter | null = null;

export function getBedrockRateLimiter(): BedrockRateLimiter {
  if (!rateLimiterInstance) {
    // Conservative limits: 20 req/min with burst of 5
    // Nova Pro has ~26 req/min quota, this leaves some buffer
    rateLimiterInstance = new BedrockRateLimiter({
      maxRequestsPerMinute: 20,
      burstSize: 5,
    });
  }
  return rateLimiterInstance;
}

/**
 * Exponential backoff retry wrapper for Bedrock calls
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if it's a throttling error
      const isThrottled = 
        error.name === 'ThrottlingException' ||
        error.message?.includes('rate is too high') ||
        error.message?.includes('Too many requests');

      if (!isThrottled || attempt === maxRetries - 1) {
        // Not a throttling error, or last attempt - throw immediately
        throw error;
      }

      // Exponential backoff with jitter
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(`Throttled on attempt ${attempt + 1}/${maxRetries}. Retrying in ${delay.toFixed(0)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export default BedrockRateLimiter;

