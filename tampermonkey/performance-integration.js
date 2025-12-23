// Performance Integration for iRacing Forum Browser Extension
// Integrates PerformanceMonitor with existing concurrent request system

// Enhanced Individual Request Handler with performance monitoring
const PerformanceAwareIndividualRequestHandler = {
    ...IndividualRequestHandler,
    
    // Enhanced individual request with performance tracking
    async makeIndividualRequest(driverName) {
        // Start performance tracking
        const requestInfo = PerformanceMonitor.startRequest(driverName, 'individual');
        
        // Create AbortController for timeout handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, this.TIMEOUT_MS);

        try {
            console.log(`Making individual request for driver: ${driverName}`);
            
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
            PerformanceMonitor.completeRequest(requestInfo, apiData);

            // Return the driver data (maintaining same API contract as batch requests)
            return apiData;

        } catch (error) {
            // Clear timeout in case of error
            clearTimeout(timeoutId);
            
            // Record failed request in performance monitor
            PerformanceMonitor.failRequest(requestInfo, error);
            
            // Re-throw error with driver context for retry logic
            error.driverName = driverName;
            throw error;
        }
    },
    
    // Enhanced retry with performance tracking
    async retryRequest(driverName, error, attempt) {
        // Record retry attempt
        PerformanceMonitor.recordRetry(driverName, attempt, error);
        
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

// Enhanced Concurrent Request Manager with performance monitoring
const PerformanceAwareConcurrentRequestManager = {
    ...ConcurrentRequestManager,
    
    // Enhanced concurrent driver fetching with performance tracking
    async fetchAllDrivers(driverNames) {
        if (!Array.isArray(driverNames) || driverNames.length === 0) {
            console.warn('ConcurrentRequestManager.fetchAllDrivers: Invalid driver names provided');
            return {};
        }
        
        const batchStartTime = performance.now();
        console.log(`Starting concurrent fetch for ${driverNames.length} drivers`);
        
        // Update performance monitor
        this.stats.totalRequests += driverNames.length;
        
        // Create individual request promises for each driver
        const requestPromises = driverNames.map(driverName => 
            this.createManagedRequest(driverName)
        );
        
        // Use Promise.allSettled to handle individual failures without failing the entire batch
        const results = await Promise.allSettled(requestPromises);
        
        // Calculate total batch time
        const batchTotalTime = performance.now() - batchStartTime;
        
        // Record batch performance for comparison
        PerformanceMonitor.recordBatchRequest(driverNames.length, batchTotalTime);
        
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
        
        console.log(`Concurrent fetch completed: ${this.stats.completedRequests} successful, ${this.stats.failedRequests} failed in ${batchTotalTime.toFixed(2)}ms`);
        
        // Log performance summary
        PerformanceMonitor.log('info', `Batch completed: ${driverNames.length} drivers in ${batchTotalTime.toFixed(2)}ms (avg: ${(batchTotalTime / driverNames.length).toFixed(2)}ms per driver)`);
        
        return combinedData;
    },
    
    // Enhanced managed request with performance integration
    async createManagedRequest(driverName) {
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
            console.log(`Starting request for driver ${driverName} (${this.activeRequests.size}/${this.MAX_CONCURRENT_REQUESTS} active)`);
            
            // Make the actual request using performance-aware handler
            const result = await PerformanceAwareIndividualRequestHandler.fetchSingleDriver(driverName);
            
            // Calculate response time
            const responseTime = Date.now() - startTime;
            this.updateResponseTimeStats(responseTime);
            
            console.log(`Completed request for driver ${driverName} in ${responseTime}ms`);
            return result;
            
        } catch (error) {
            const responseTime = Date.now() - startTime;
            console.error(`Failed request for driver ${driverName} after ${responseTime}ms:`, error);
            throw error;
            
        } finally {
            // Always clean up the request tracking
            this.activeRequests.delete(requestId);
            
            // Process any queued requests
            this.processQueue();
        }
    }
};

// Enhanced Cache Manager with performance monitoring
const PerformanceAwareCacheManager = {
    ...CacheManager,
    
    // Enhanced cache get with performance tracking
    get(driverName) {
        const cached = CacheManager.get.call(this, driverName);
        
        // Record cache hit/miss
        PerformanceMonitor.recordCacheEvent(driverName, cached !== null);
        
        return cached;
    },
    
    // Enhanced cache set with performance tracking
    set(driverName, data) {
        const result = CacheManager.set.call(this, driverName, data);
        
        if (result) {
            PerformanceMonitor.log('debug', `Cached data for driver: ${driverName}`);
        } else {
            PerformanceMonitor.log('warn', `Failed to cache data for driver: ${driverName}`);
        }
        
        return result;
    }
};

// Enhanced Error Handler with performance integration
const PerformanceAwareErrorHandler = {
    ...ErrorHandler,
    
    // Enhanced individual driver error handling with performance tracking
    handleIndividualDriverError(error, driverName) {
        if (!driverName) {
            console.warn('ErrorHandler.handleIndividualDriverError: Missing driver name');
            return null;
        }

        const errorInfo = this.handleApiError(error, driverName);
        
        // Update concurrent request metrics (existing functionality)
        this.updateConcurrentMetrics('error', driverName, errorInfo.type);
        
        // Additional performance logging
        PerformanceMonitor.log('warn', `Driver error handled: ${driverName} - ${errorInfo.type}`, {
            driverName: driverName,
            errorType: errorInfo.type,
            errorMessage: errorInfo.message
        });
        
        return errorInfo;
    },
    
    // Enhanced success marking with performance integration
    markDriverSuccess(driverName, responseTime = 0) {
        if (!driverName) {
            return;
        }

        this.concurrentMetrics.successfulDrivers.add(driverName);
        this.updateConcurrentMetrics('success', driverName, null, responseTime);
        
        // Additional performance logging
        PerformanceMonitor.log('info', `Driver success marked: ${driverName} (${responseTime}ms)`);
        
        console.log(`ErrorHandler: Marked driver ${driverName} as successful (${responseTime}ms)`);
    }
};

// Performance-aware main fetch function
async function fetchDriverDataWithPerformance(driverNames) {
    if (!Array.isArray(driverNames) || driverNames.length === 0) {
        console.warn('fetchDriverDataWithPerformance: Invalid driver names provided');
        return {};
    }

    console.log(`Starting performance-aware fetch for ${driverNames.length} drivers`);
    
    // Initialize performance monitoring if not already done
    if (!PerformanceMonitor.metrics.session.startTime) {
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
            const cached = PerformanceAwareCacheManager.get(driverName);
            if (cached) {
                cachedData[driverName] = cached;
                console.log(`Using cached data for driver: ${driverName}`);
            } else {
                uncachedDrivers.push(driverName);
            }
        });
        
        console.log(`Found ${Object.keys(cachedData).length} cached drivers, ${uncachedDrivers.length} need API requests`);
        
        // Fetch uncached drivers concurrently
        let apiData = {};
        if (uncachedDrivers.length > 0) {
            apiData = await PerformanceAwareConcurrentRequestManager.fetchAllDrivers(uncachedDrivers);
            
            // Cache successful responses
            Object.entries(apiData).forEach(([driverName, driverData]) => {
                if (driverData && !driverData.error) {
                    PerformanceAwareCacheManager.set(driverName, driverData);
                }
            });
        }
        
        // Combine cached and API data
        const combinedData = { ...cachedData, ...apiData };
        
        // Update session metrics
        PerformanceMonitor.metrics.session.pagesProcessed++;
        
        console.log(`Performance-aware fetch completed: ${Object.keys(combinedData).length} drivers processed`);
        
        return combinedData;

    } catch (error) {
        console.error('fetchDriverDataWithPerformance error:', error);
        PerformanceMonitor.log('error', 'Fetch error', error);
        
        // Return empty object to prevent breaking the UI
        return {};
    }
}

// Initialize performance monitoring when this module loads
if (typeof window !== 'undefined') {
    // Auto-initialize performance monitoring
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            PerformanceMonitor.initialize();
        });
    } else {
        PerformanceMonitor.initialize();
    }
    
    // Export enhanced components
    window.PerformanceAwareIndividualRequestHandler = PerformanceAwareIndividualRequestHandler;
    window.PerformanceAwareConcurrentRequestManager = PerformanceAwareConcurrentRequestManager;
    window.PerformanceAwareCacheManager = PerformanceAwareCacheManager;
    window.PerformanceAwareErrorHandler = PerformanceAwareErrorHandler;
    window.fetchDriverDataWithPerformance = fetchDriverDataWithPerformance;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PerformanceAwareIndividualRequestHandler,
        PerformanceAwareConcurrentRequestManager,
        PerformanceAwareCacheManager,
        PerformanceAwareErrorHandler,
        fetchDriverDataWithPerformance
    };
}