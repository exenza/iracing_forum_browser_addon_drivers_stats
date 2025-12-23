/**
 * Concurrent Cache Storage
 * Thread-safe cache implementation for concurrent driver data requests
 */
class ConcurrentCacheStorage {
  constructor() {
    this.cache = new Map();
    this.pendingRequests = new Map();
    this.locks = new Map();
  }

  // Basic cache operations
  set(key, value) {
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      accessCount: 0
    });
  }

  get(key) {
    const entry = this.cache.get(key);
    if (entry) {
      entry.accessCount++;
      return entry.data;
    }
    return undefined;
  }

  has(key) {
    return this.cache.has(key);
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
    this.pendingRequests.clear();
    this.locks.clear();
  }

  // Pending request management
  setPending(key, promise) {
    this.pendingRequests.set(key, promise);
  }

  getPending(key) {
    return this.pendingRequests.get(key);
  }

  hasPending(key) {
    return this.pendingRequests.has(key);
  }

  clearPending(key) {
    this.pendingRequests.delete(key);
  }

  // Lock management for concurrent access
  async acquireLock(key) {
    while (this.locks.has(key)) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    this.locks.set(key, true);
  }

  releaseLock(key) {
    this.locks.delete(key);
  }

  // Cache statistics
  getStats() {
    const entries = Array.from(this.cache.values());
    return {
      size: this.cache.size,
      pendingRequests: this.pendingRequests.size,
      totalAccesses: entries.reduce((sum, entry) => sum + entry.accessCount, 0),
      averageAge: entries.length > 0 
        ? entries.reduce((sum, entry) => sum + (Date.now() - entry.timestamp), 0) / entries.length
        : 0
    };
  }

  // Cache maintenance
  cleanup(maxAge = 300000) { // 5 minutes default
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.cache.delete(key);
      }
    }
  }

  // Get all keys
  keys() {
    return Array.from(this.cache.keys());
  }

  // Get cache size
  size() {
    return this.cache.size;
  }
}

// Export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConcurrentCacheStorage;
}

// Make available globally for browser
if (typeof window !== 'undefined') {
  window.ConcurrentCacheStorage = ConcurrentCacheStorage;
}