// Cache-First Concurrent Request Manager
// Integrates enhanced cache operations with concurrent request processing

// Cache-First Concurrent Request Manager
const CacheFirstConcurrentManager = {
    // Inherit all concurrent request manager functionality
    ...ConcurrentRequestManager,
    
    // Enhanced fetchAllDrivers with cache-first behavior
    async fetchAllDrivers(driverNames) {
        if (!Array.isArray(driverNames) || driverNames.length === 0) {
            console.warn('CacheFirstConcurrentManager.fetchAllDrivers: Invalid driver names provided');
            return {};
        }
        
        console.log(`Starting cache-first concurrent fetch for ${driverNames.length} drivers`);
        const startTime = Date.now();
        
        // Step 1: Separate cached and uncached drivers
        const separation = EnhancedCacheManager.separateCachedAndUncached(driverNames);
        const { cached, uncached, stats } = separation;
        
        // Step 2: Display cached drivers immediately
        if (Object.keys(cached).length > 0) {
            console.log(`Displaying ${Object.keys(cached).length} cached drivers immediately`);
            this.displayCachedDriversImmediately(cached);
        }
        
        // Step 3: If all drivers are cached, return immediately
        if (uncached.length === 0) {
            console.log('All drivers found in cache, no API requests needed');
            return cached;
        }
        
        // Step 4: Make concurrent requests for uncached drivers only
        console.log(`Making concurrent requests for ${uncached.length} uncached drivers`);
        this.stats.totalRequests += uncached.length;
        
        // Create individual request promises for uncached drivers
        const requestPromises = uncached.map(driverName => 
            this.createCacheAwareManagedRequest(driverName)
        );
        
        // Use Promise.allSettled to handle individual failures
        const results = await Promise.allSettled(requestPromises);
        
        // Step 5: Process API results and cache them
        const apiData = {};
        
        results.forEach((result, index) => {
            const driverName = uncached[index];
            
            if (result.status === 'fulfilled') {
                // Successful request - merge driver data and cache it
                if (result.value && typeof result.value === 'object') {
                    Object.assign(apiData, result.value);
                    
                    // Cache individual driver data using concurrent cache storage
                    const cachePromises = Object.keys(result.value).map(async (responseDriverName) => {
                        if (result.value[responseDriverName] && !result.value[responseDriverName].error) {
                            return await ConcurrentCacheStorage.setDriverConcurrent(responseDriverName, result.value[responseDriverName]);
                        }
                        return false;
                    });
                    
                    // Wait for all cache operations to complete
                    await Promise.allSettled(cachePromises);
                    
                    this.stats.completedRequests++;
                } else {
                    // Invalid response format
                    apiData[driverName] = {
                        error: true,
                        errorType: 'data',
                        errorMessage: 'Invalid response format',
                        driverName: driverName
                    };
                    this.stats.failedRequests++;
                }
            } else {
                // Failed request - create error entry
                const error = result.reason;
                apiData[driverName] = {
                    error: true,
                    errorType: this.categorizeError(error),
                    errorMessage: this.getErrorMessage(error),
                    driverName: driverName,
                    originalError: error
                };
                this.stats.failedRequests++;
            }
        });
        
        // Step 6: Combine cached and API data
        const combinedData = { ...cached, ...apiData };
        
        const totalTime = Date.now() - startTime;
        console.log(`Cache-first concurrent fetch completed in ${totalTime}ms: ${stats.cached} cached, ${this.stats.completedRequests} API successes, ${this.stats.failedRequests} API failures`);
        
        return combinedData;
    },
    
    // Display cached drivers immediately without waiting for API requests
    displayCachedDriversImmediately(cachedData) {
        if (!cachedData || typeof cachedData !== 'object') {
            console.warn('CacheFirstConcurrentManager.displayCachedDriversImmediately: Invalid cached data');
            return;
        }
        
        Object.keys(cachedData).forEach(driverName => {
            try {
                // Get all elements associated with this driver
                const associatedElements = RequestDeduplicationManager.getElementsForDriver(driverName);
                
                if (associatedElements.length === 0) {
                    console.warn(`No elements found for cached driver: ${driverName}`);
                    return;
                }
                
                // Update all elements for this driver with cached data
                RequestDeduplicationManager.updateAllElementsForDriver(driverName, (element, currentDriver) => {
                    // Use the render function to display cached data
                    if (typeof render === 'function') {
                        render({ [currentDriver]: cachedData[currentDriver] });
                    } else {
                        // Fallback: hide loading and show cached indicator
                        LoadingManager.hideLoadingForElement(element, 
                            `<span class="cached-data">Cached data for ${currentDriver}</span>`);
                    }
                });
                
                console.log(`Displayed cached data for driver: ${driverName}`);
                
            } catch (error) {
                console.error(`Error displaying cached data for driver ${driverName}:`, error);
            }
        });
    },
    
    // Create cache-aware managed request
    async createCacheAwareManagedRequest(driverName) {
        // Double-check cache before making request (race condition protection)
        const lastMinuteCache = await ConcurrentCacheStorage.getDriverConcurrent(driverName);
        if (lastMinuteCache) {
            console.log(`Last-minute cache hit for driver: ${driverName}`);
            return { [driverName]: lastMinuteCache };
        }
        
        // Check if we need to queue this request due to concurrency limits
        if (this.activeRequests.size >= this.MAX_CONCURRENT_REQUESTS) {
            console.log(`Queueing cache-aware request for driver ${driverName} (${this.activeRequests.size}/${this.MAX_CONCURRENT_REQUESTS} active)`);
            await this.waitForSlot();
        }
        
        // Create request with tracking
        const requestId = this.generateRequestId(driverName);
        const startTime = Date.now();
        
        // Create AbortController for cleanup capability
        const controller = new AbortController();
        
        // Track this request
        this.activeRequests.set(requestId, {
            driverName: driverName,
            startTime: startTime,
            controller: controller,
            cacheChecked: true // Mark that cache was checked
        });
        
        // Update peak concurrent count
        if (this.activeRequests.size > this.stats.concurrentPeakCount) {
            this.stats.concurrentPeakCount = this.activeRequests.size;
        }
        
        try {
            console.log(`Starting cache-aware request for driver ${driverName} (${this.activeRequests.size}/${this.MAX_CONCURRENT_REQUESTS} active)`);
            
            // Make the actual request
            const result = await IndividualRequestHandler.fetchSingleDriver(driverName);
            
            // Calculate response time
            const responseTime = Date.now() - startTime;
            this.updateResponseTimeStats(responseTime);
            
            console.log(`Completed cache-aware request for driver ${driverName} in ${responseTime}ms`);
            return result;
            
        } catch (error) {
            const responseTime = Date.now() - startTime;
            console.error(`Failed cache-aware request for driver ${driverName} after ${responseTime}ms:`, error);
            throw error;
            
        } finally {
            // Always clean up the request tracking
            this.activeRequests.delete(requestId);
            
            // Process any queued requests
            this.processQueue();
        }
    },
    
    // Enhanced request deduplication with cache awareness
    async fetchSingleDriverWithDeduplication(driverName) {
        // Use RequestDeduplicationManager to handle duplicate requests
        return RequestDeduplicationManager.getOrCreateRequest(driverName, async (name) => {
            // Check cache first
            const cached = await ConcurrentCacheStorage.getDriverConcurrent(name);
            if (cached) {
                console.log(`Deduplication: Returning cached data for driver ${name}`);
                return { [name]: cached };
            }
            
            // Make individual request if not cached
            console.log(`Deduplication: Making new request for driver ${name}`);
            return await this.createCacheAwareManagedRequest(name);
        });
    },
    
    // Batch cache operations for efficiency
    async fetchMultipleDriversWithBatchCaching(driverNames) {
        if (!Array.isArray(driverNames) || driverNames.length === 0) {
            return {};
        }
        
        // Batch cache check
        const cacheResult = EnhancedCacheManager.getMultipleDrivers(driverNames);
        const { data: cachedData, stats: cacheStats } = cacheResult;
        
        // Get uncached drivers
        const uncachedDrivers = driverNames.filter(name => !cachedData[name]);
        
        if (uncachedDrivers.length === 0) {
            console.log(`All ${driverNames.length} drivers found in cache`);
            return cachedData;
        }
        
        // Fetch uncached drivers
        const apiResults = await this.fetchAllDrivers(uncachedDrivers);
        
        // Batch cache the new results
        const newDriverData = {};
        Object.keys(apiResults).forEach(driverName => {
            if (apiResults[driverName] && !apiResults[driverName].error) {
                newDriverData[driverName] = apiResults[driverName];
            }
        });
        
        if (Object.keys(newDriverData).length > 0) {
            await ConcurrentCacheStorage.cacheIndividualResponses(newDriverData);
        }
        
        // Combine cached and new data
        return { ...cachedData, ...apiResults };
    },
    
    // Get enhanced statistics including cache performance
    getEnhancedStats() {
        const baseStats = this.getRequestStats();
        const cacheStats = ConcurrentCacheStorage.getConcurrentCacheStats();
        
        return {
            ...baseStats,
            cache: cacheStats,
            timestamp: new Date().toISOString()
        };
    },
    
    // Preload drivers that are likely to be requested
    async preloadDrivers(driverNames, priority = 'low') {
        if (!Array.isArray(driverNames) || driverNames.length === 0) {
            console.warn('CacheFirstConcurrentManager.preloadDrivers: Invalid driver names');
            return { preloaded: 0, alreadyCached: 0, failed: 0 };
        }
        
        console.log(`Preloading ${driverNames.length} drivers with ${priority} priority`);
        
        // Check which drivers are already cached
        const separation = EnhancedCacheManager.separateCachedAndUncached(driverNames);
        const uncachedDrivers = separation.uncached;
        
        if (uncachedDrivers.length === 0) {
            console.log('All drivers already cached, no preloading needed');
            return { 
                preloaded: 0, 
                alreadyCached: separation.cached.length, 
                failed: 0 
            };
        }
        
        // For low priority, limit concurrent preload requests
        const maxConcurrentPreload = priority === 'high' ? this.MAX_CONCURRENT_REQUESTS : 2;
        const preloadResults = { preloaded: 0, alreadyCached: separation.cached.length, failed: 0 };
        
        // Process in batches to avoid overwhelming the system
        for (let i = 0; i < uncachedDrivers.length; i += maxConcurrentPreload) {
            const batch = uncachedDrivers.slice(i, i + maxConcurrentPreload);
            
            try {
                const batchResults = await this.fetchAllDrivers(batch);
                
                Object.keys(batchResults).forEach(driverName => {
                    if (batchResults[driverName] && !batchResults[driverName].error) {
                        preloadResults.preloaded++;
                    } else {
                        preloadResults.failed++;
                    }
                });
                
            } catch (error) {
                console.warn(`Preload batch failed:`, error);
                preloadResults.failed += batch.length;
            }
            
            // Small delay between batches for low priority preloading
            if (priority === 'low' && i + maxConcurrentPreload < uncachedDrivers.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        console.log(`Preloading completed: ${preloadResults.preloaded} preloaded, ${preloadResults.alreadyCached} already cached, ${preloadResults.failed} failed`);
        return preloadResults;
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CacheFirstConcurrentManager };
}