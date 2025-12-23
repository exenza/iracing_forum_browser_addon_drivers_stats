// Performance and Prioritization Integration for iRacing Forum Browser Extension
// Combines PerformanceMonitor, RequestPrioritizer, and existing concurrent request system

// Enhanced Concurrent Request Manager with Performance and Prioritization
const PerformancePrioritizedConcurrentRequestManager = {
    ...ConcurrentRequestManager,
    
    // Enhanced fetchAllDrivers with performance monitoring and request prioritization
    async fetchAllDrivers(driverNames) {
        if (!Array.isArray(driverNames) || driverNames.length === 0) {
            console.warn('PerformancePrioritizedConcurrentRequestManager.fetchAllDrivers: Invalid driver names provided');
            return {};
        }
        
        const batchStartTime = performance.now();
        console.log(`Starting performance-prioritized concurrent fetch for ${driverNames.length} drivers`);
        
        // Update performance monitor
        this.stats.totalRequests += driverNames.length;
        
        // Create prioritized request promises for each driver
        const requestPromises = driverNames.map(driverName => 
            this.createPrioritizedManagedRequest(driverName)
        );
        
        // Use Promise.allSettled to handle individual failures without failing the entire batch
        const results = await Promise.allSettled(requestPromises);
        
        // Calculate total batch time
        const batchTotalTime = performance.now() - batchStartTime;
        
        // Record batch performance for comparison
        if (typeof PerformanceMonitor !== 'undefined') {
            PerformanceMonitor.recordBatchRequest(driverNames.length, batchTotalTime);
        }
        
        // Process results and combine into single response object
        const combinedData = {};
        
        results.forEach((result, index) => {
            const driverName = driverNames[index];
            
            if (result.status === 'fulfilled') {
                // Successful request - merge driver data
                if (result.value && typeof result.value === 'object') {
                    Object.assign(combinedData, result.value);
                    this.stats.completedRequests++;
                } else {
                    // Invalid response format
                    combinedData[driverName] = {
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
                combinedData[driverName] = {
                    error: true,
                    errorType: this.categorizeError(error),
                    errorMessage: this.getErrorMessage(error),
                    driverName: driverName,
                    originalError: error
                };
                this.stats.failedRequests++;
            }
        });
        
        console.log(`Performance-prioritized concurrent fetch completed: ${this.stats.completedRequests} successful, ${this.stats.failedRequests} failed in ${batchTotalTime.toFixed(2)}ms`);
        
        // Log performance summary
        if (typeof PerformanceMonitor !== 'undefined') {
            PerformanceMonitor.log('info', `Prioritized batch completed: ${driverNames.length} drivers in ${batchTotalTime.toFixed(2)}ms (avg: ${(batchTotalTime / driverNames.length).toFixed(2)}ms per driver)`);
        }
        
        return combinedData;
    },
    
    // Create a prioritized managed request
    async createPrioritizedManagedRequest(driverName) {
        // Use RequestPrioritizer if available, otherwise fall back to standard request
        if (typeof RequestPrioritizer !== 'undefined' && RequestPrioritizer.createPrioritizedRequest) {
            return RequestPrioritizer.createPrioritizedRequest(
                driverName,
                (name) => this.createStandardManagedRequest(name),
                {
                    canDefer: true,
                    maxRetries: 3,
                    timeout: 10000
                }
            );
        } else {
            // Fallback to standard managed request
            return this.createStandardManagedRequest(driverName);
        }
    },
    
    // Standard managed request (renamed from original createManagedRequest)
    async createStandardManagedRequest(driverName) {
        // Check if we need to queue this request due to concurrency limits
        if (this.activeRequests.size >= this.MAX_CONCURRENT_REQUESTS) {
            console.log(`Queueing request for driver ${driverName} (${this.activeRequests.size}/${this.MAX_CONCURRENT_REQUESTS} active)`);
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
            controller: controller
        });
        
        // Update peak concurrent count
        if (this.activeRequests.size > this.stats.concurrentPeakCount) {
            this.stats.concurrentPeakCount = this.activeRequests.size;
        }
        
        try {
            console.log(`Starting prioritized request for driver ${driverName} (${this.activeRequests.size}/${this.MAX_CONCURRENT_REQUESTS} active)`);
            
            // Make the actual request using performance-aware handler
            const result = await PerformanceAwareIndividualRequestHandler.fetchSingleDriver(driverName);
            
            // Calculate response time
            const responseTime = Date.now() - startTime;
            this.updateResponseTimeStats(responseTime);
            
            console.log(`Completed prioritized request for driver ${driverName} in ${responseTime}ms`);
            return result;
            
        } catch (error) {
            const responseTime = Date.now() - startTime;
            console.error(`Failed prioritized request for driver ${driverName} after ${responseTime}ms:`, error);
            throw error;
            
        } finally {
            // Always clean up the request tracking
            this.activeRequests.delete(requestId);
            
            // Process any queued requests
            this.processQueue();
        }
    }
};

// Enhanced Individual Request Handler with Performance and Prioritization
const PerformancePrioritizedIndividualRequestHandler = {
    ...IndividualRequestHandler,
    
    // Enhanced individual request with performance tracking and prioritization
    async makeIndividualRequest(driverName) {
        // Start performance tracking if available
        let requestInfo = null;
        if (typeof PerformanceMonitor !== 'undefined') {
            requestInfo = PerformanceMonitor.startRequest(driverName, 'individual');
        }
        
        // Create AbortController for timeout handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, this.TIMEOUT_MS);

        try {
            console.log(`Making performance-prioritized individual request for driver: ${driverName}`);
            
            const response = await fetch(this.createRequestUrl(driverName), {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            // Clear timeout if request completes
            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                throw error;
            }

            const apiData = await response.json();

            // Validate API response structure
            if (!apiData || typeof apiData !== 'object') {
                throw new Error('Invalid API response format');
            }

            // Complete performance tracking for successful request
            if (requestInfo && typeof PerformanceMonitor !== 'undefined') {
                PerformanceMonitor.completeRequest(requestInfo, apiData);
            }

            // Return the driver data (maintaining same API contract as batch requests)
            return apiData;

        } catch (error) {
            // Clear timeout in case of error
            clearTimeout(timeoutId);
            
            // Record failed request in performance monitor
            if (requestInfo && typeof PerformanceMonitor !== 'undefined') {
                PerformanceMonitor.failRequest(requestInfo, error);
            }
            
            // Re-throw error with driver context for retry logic
            error.driverName = driverName;
            throw error;
        }
    },
    
    // Enhanced retry with performance tracking
    async retryRequest(driverName, error, attempt) {
        // Record retry attempt
        if (typeof PerformanceMonitor !== 'undefined') {
            PerformanceMonitor.recordRetry(driverName, attempt, error);
        }
        
        if (!this.isRetryableError(error) || attempt >= this.MAX_RETRIES) {
            throw error;
        }
        
        // Exponential backoff: 1s, 2s, 4s
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.warn(`Attempt ${attempt} failed for driver ${driverName}. Retrying in ${delay}ms...`);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
        
        try {
            return await this.makeIndividualRequest(driverName);
        } catch (retryError) {
            return await this.retryRequest(driverName, retryError, attempt + 1);
        }
    }
};

// Enhanced Cache Manager with Performance Tracking
const PerformancePrioritizedCacheManager = {
    ...CacheManager,
    
    // Enhanced cache get with performance tracking
    get(driverName) {
        const cached = CacheManager.get.call(this, driverName);
        
        // Record cache hit/miss
        if (typeof PerformanceMonitor !== 'undefined') {
            PerformanceMonitor.recordCacheEvent(driverName, cached !== null);
        }
        
        return cached;
    },
    
    // Enhanced cache set with performance tracking
    set(driverName, data) {
        const result = CacheManager.set.call(this, driverName, data);
        
        if (result && typeof PerformanceMonitor !== 'undefined') {
            PerformanceMonitor.log('debug', `Cached data for driver: ${driverName}`);
        } else if (!result && typeof PerformanceMonitor !== 'undefined') {
            PerformanceMonitor.log('warn', `Failed to cache data for driver: ${driverName}`);
        }
        
        return result;
    }
};

// Performance-prioritized main fetch function
async function fetchDriverDataWithPerformanceAndPrioritization(driverNames) {
    if (!Array.isArray(driverNames) || driverNames.length === 0) {
        console.warn('fetchDriverDataWithPerformanceAndPrioritization: Invalid driver names provided');
        return {};
    }

    console.log(`Starting performance-prioritized fetch for ${driverNames.length} drivers`);
    
    // Initialize performance monitoring if not already done
    if (typeof PerformanceMonitor !== 'undefined' && !PerformanceMonitor.metrics.session.startTime) {
        PerformanceMonitor.initialize();
    }
    
    try {
        // Deduplicate driver names
        const uniqueDriverNames = [...new Set(driverNames)];
        console.log(`Deduplicated to ${uniqueDriverNames.length} unique drivers`);
        
        // Check cache for each driver first
        const cachedData = {};
        const uncachedDrivers = [];
        
        uniqueDriverNames.forEach(driverName => {
            const cached = PerformancePrioritizedCacheManager.get(driverName);
            if (cached) {
                cachedData[driverName] = cached;
                console.log(`Using cached data for driver: ${driverName}`);
            } else {
                uncachedDrivers.push(driverName);
            }
        });
        
        console.log(`Found ${Object.keys(cachedData).length} cached drivers, ${uncachedDrivers.length} need API requests`);
        
        // Fetch uncached drivers concurrently with performance monitoring and prioritization
        let apiData = {};
        if (uncachedDrivers.length > 0) {
            apiData = await PerformancePrioritizedConcurrentRequestManager.fetchAllDrivers(uncachedDrivers);
            
            // Cache successful responses
            Object.entries(apiData).forEach(([driverName, driverData]) => {
                if (driverData && !driverData.error) {
                    PerformancePrioritizedCacheManager.set(driverName, driverData);
                }
            });
        }
        
        // Combine cached and API data
        const combinedData = { ...cachedData, ...apiData };
        
        // Update session metrics
        if (typeof PerformanceMonitor !== 'undefined') {
            PerformanceMonitor.metrics.session.pagesProcessed++;
        }
        
        console.log(`Performance-prioritized fetch completed: ${Object.keys(combinedData).length} drivers processed`);
        
        return combinedData;

    } catch (error) {
        console.error('fetchDriverDataWithPerformanceAndPrioritization error:', error);
        if (typeof PerformanceMonitor !== 'undefined') {
            PerformanceMonitor.log('error', 'Fetch error', error);
        }
        
        // Return empty object to prevent breaking the UI
        return {};
    }
}

// Initialize performance and prioritization integration when this module loads
if (typeof window !== 'undefined') {
    // Auto-initialize performance monitoring and prioritization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof PerformanceMonitor !== 'undefined') {
                PerformanceMonitor.initialize();
            }
            if (typeof RequestPrioritizer !== 'undefined') {
                RequestPrioritizer.initialize();
            }
        });
    } else {
        if (typeof PerformanceMonitor !== 'undefined') {
            PerformanceMonitor.initialize();
        }
        if (typeof RequestPrioritizer !== 'undefined') {
            RequestPrioritizer.initialize();
        }
    }
    
    // Export enhanced components
    window.PerformancePrioritizedConcurrentRequestManager = PerformancePrioritizedConcurrentRequestManager;
    window.PerformancePrioritizedIndividualRequestHandler = PerformancePrioritizedIndividualRequestHandler;
    window.PerformancePrioritizedCacheManager = PerformancePrioritizedCacheManager;
    window.fetchDriverDataWithPerformanceAndPrioritization = fetchDriverDataWithPerformanceAndPrioritization;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PerformancePrioritizedConcurrentRequestManager,
        PerformancePrioritizedIndividualRequestHandler,
        PerformancePrioritizedCacheManager,
        fetchDriverDataWithPerformanceAndPrioritization
    };
}