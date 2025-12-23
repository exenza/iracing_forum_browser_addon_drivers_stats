// Enhanced Cache Manager for Individual Driver Operations
// Extends the existing CacheManager with individual operations optimized for concurrent access

// Enhanced Cache Manager for individual driver operations
const EnhancedCacheManager = {
    // Inherit all existing CacheManager functionality
    ...CacheManager,
    
    // Individual cache operations for concurrent access
    
    // Get cached data for a single driver (optimized for individual requests)
    getDriver(driverName) {
        if (!driverName || typeof driverName !== 'string') {
            console.warn('EnhancedCacheManager.getDriver: Invalid driver name provided');
            return null;
        }
        
        try {
            const cached = this.get(driverName);
            if (cached) {
                console.log(`Cache hit for driver: ${driverName}`);
                return cached;
            } else {
                console.log(`Cache miss for driver: ${driverName}`);
                return null;
            }
        } catch (error) {
            console.warn(`EnhancedCacheManager.getDriver error for ${driverName}:`, error);
            return null;
        }
    },
    
    // Set cached data for a single driver (optimized for individual responses)
    setDriver(driverName, data) {
        if (!driverName || typeof driverName !== 'string') {
            console.warn('EnhancedCacheManager.setDriver: Invalid driver name provided');
            return false;
        }
        
        if (!data || typeof data !== 'object') {
            console.warn('EnhancedCacheManager.setDriver: Invalid data provided for driver:', driverName);
            return false;
        }
        
        try {
            const success = this.set(driverName, data);
            if (success) {
                console.log(`Cached data for driver: ${driverName}`);
            } else {
                console.warn(`Failed to cache data for driver: ${driverName}`);
            }
            return success;
        } catch (error) {
            console.warn(`EnhancedCacheManager.setDriver error for ${driverName}:`, error);
            return false;
        }
    },
    
    // Get cached data for multiple drivers efficiently
    getMultipleDrivers(driverNames) {
        if (!Array.isArray(driverNames)) {
            console.warn('EnhancedCacheManager.getMultipleDrivers: driverNames must be an array');
            return {};
        }
        
        const cachedData = {};
        const cacheStats = {
            hits: 0,
            misses: 0,
            errors: 0
        };
        
        driverNames.forEach(driverName => {
            try {
                const cached = this.getDriver(driverName);
                if (cached) {
                    cachedData[driverName] = cached;
                    cacheStats.hits++;
                } else {
                    cacheStats.misses++;
                }
            } catch (error) {
                console.warn(`Error getting cached data for driver ${driverName}:`, error);
                cacheStats.errors++;
            }
        });
        
        console.log(`Cache check for ${driverNames.length} drivers: ${cacheStats.hits} hits, ${cacheStats.misses} misses, ${cacheStats.errors} errors`);
        
        return {
            data: cachedData,
            stats: cacheStats
        };
    },
    
    // Set cached data for multiple drivers efficiently
    setMultipleDrivers(driverDataMap) {
        if (!driverDataMap || typeof driverDataMap !== 'object') {
            console.warn('EnhancedCacheManager.setMultipleDrivers: Invalid driverDataMap provided');
            return false;
        }
        
        const cacheStats = {
            successes: 0,
            failures: 0,
            errors: 0
        };
        
        Object.keys(driverDataMap).forEach(driverName => {
            try {
                const success = this.setDriver(driverName, driverDataMap[driverName]);
                if (success) {
                    cacheStats.successes++;
                } else {
                    cacheStats.failures++;
                }
            } catch (error) {
                console.warn(`Error caching data for driver ${driverName}:`, error);
                cacheStats.errors++;
            }
        });
        
        console.log(`Cached ${Object.keys(driverDataMap).length} drivers: ${cacheStats.successes} successes, ${cacheStats.failures} failures, ${cacheStats.errors} errors`);
        
        return cacheStats.successes > 0;
    },
    
    // Check if driver data is cached and not expired
    isDriverCached(driverName) {
        if (!driverName || typeof driverName !== 'string') {
            return false;
        }
        
        try {
            const cached = this.getDriver(driverName);
            return cached !== null;
        } catch (error) {
            console.warn(`EnhancedCacheManager.isDriverCached error for ${driverName}:`, error);
            return false;
        }
    },
    
    // Get cache statistics for monitoring
    getCacheStats() {
        if (!window.sessionStorage) {
            return {
                available: false,
                totalEntries: 0,
                driverEntries: 0,
                estimatedSize: 0
            };
        }
        
        let totalEntries = 0;
        let driverEntries = 0;
        let estimatedSize = 0;
        
        try {
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key) {
                    totalEntries++;
                    if (key.startsWith(this.CACHE_PREFIX)) {
                        driverEntries++;
                        const value = sessionStorage.getItem(key);
                        if (value) {
                            estimatedSize += key.length + value.length;
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('EnhancedCacheManager.getCacheStats error:', error);
        }
        
        return {
            available: true,
            totalEntries: totalEntries,
            driverEntries: driverEntries,
            estimatedSize: estimatedSize,
            cacheTTL: this.CACHE_TTL,
            cachePrefix: this.CACHE_PREFIX
        };
    },
    
    // Warm up cache for frequently accessed drivers
    warmupCache(driverNames) {
        if (!Array.isArray(driverNames)) {
            console.warn('EnhancedCacheManager.warmupCache: driverNames must be an array');
            return false;
        }
        
        console.log(`Warming up cache for ${driverNames.length} drivers`);
        
        // This is a placeholder for cache warming logic
        // In a real implementation, this might pre-fetch data for these drivers
        const cachedDrivers = [];
        
        driverNames.forEach(driverName => {
            if (this.isDriverCached(driverName)) {
                cachedDrivers.push(driverName);
            }
        });
        
        console.log(`Cache warmup complete: ${cachedDrivers.length}/${driverNames.length} drivers already cached`);
        
        return {
            requested: driverNames.length,
            alreadyCached: cachedDrivers.length,
            cachedDrivers: cachedDrivers
        };
    },
    
    // Separate cached and uncached drivers for efficient processing
    separateCachedAndUncached(driverNames) {
        if (!Array.isArray(driverNames)) {
            console.warn('EnhancedCacheManager.separateCachedAndUncached: driverNames must be an array');
            return {
                cached: {},
                uncached: [],
                stats: { cached: 0, uncached: 0 }
            };
        }
        
        const cached = {};
        const uncached = [];
        
        driverNames.forEach(driverName => {
            const cachedData = this.getDriver(driverName);
            if (cachedData) {
                cached[driverName] = cachedData;
            } else {
                uncached.push(driverName);
            }
        });
        
        const stats = {
            cached: Object.keys(cached).length,
            uncached: uncached.length,
            total: driverNames.length,
            cacheHitRate: driverNames.length > 0 ? (Object.keys(cached).length / driverNames.length * 100).toFixed(1) + '%' : '0%'
        };
        
        console.log(`Cache separation: ${stats.cached} cached, ${stats.uncached} uncached (${stats.cacheHitRate} hit rate)`);
        
        return {
            cached: cached,
            uncached: uncached,
            stats: stats
        };
    },
    
    // Enhanced cleanup with better performance monitoring
    cleanupExpired() {
        if (!window.sessionStorage) {
            console.warn('EnhancedCacheManager.cleanupExpired: sessionStorage not available');
            return { removed: 0, errors: 0 };
        }
        
        const startTime = Date.now();
        let removed = 0;
        let errors = 0;
        
        try {
            const keysToRemove = [];
            
            // First pass: identify expired entries
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && key.startsWith(this.CACHE_PREFIX)) {
                    try {
                        const cached = sessionStorage.getItem(key);
                        if (cached) {
                            const parsedData = JSON.parse(cached);
                            if (this.isExpired(parsedData.timestamp)) {
                                keysToRemove.push(key);
                            }
                        }
                    } catch (parseError) {
                        // Remove corrupted entries
                        keysToRemove.push(key);
                        errors++;
                    }
                }
            }
            
            // Second pass: remove expired entries
            keysToRemove.forEach(key => {
                try {
                    sessionStorage.removeItem(key);
                    removed++;
                } catch (removeError) {
                    console.warn(`Error removing expired cache entry ${key}:`, removeError);
                    errors++;
                }
            });
            
        } catch (error) {
            console.warn('EnhancedCacheManager.cleanupExpired error:', error);
            errors++;
        }
        
        const cleanupTime = Date.now() - startTime;
        console.log(`Cache cleanup completed in ${cleanupTime}ms: ${removed} entries removed, ${errors} errors`);
        
        return {
            removed: removed,
            errors: errors,
            cleanupTime: cleanupTime
        };
    },
    
    // Get detailed cache information for debugging
    getDetailedCacheInfo() {
        const stats = this.getCacheStats();
        const cleanupInfo = this.cleanupExpired();
        
        return {
            ...stats,
            lastCleanup: cleanupInfo,
            timestamp: new Date().toISOString()
        };
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EnhancedCacheManager };
}