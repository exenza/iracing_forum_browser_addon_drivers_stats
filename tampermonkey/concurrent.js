// Concurrent Request Manager for iRacing Forum Browser Extension
// Handles concurrent individual driver requests with proper limiting and cleanup

// Individual Request Handler (from previous task)
const IndividualRequestHandler = {
    TIMEOUT_MS: 10000, // 10 seconds per request
    MAX_RETRIES: 3,
    
    // Create individual API URL for a single driver
    createRequestUrl(driverName) {
        return `${CONFIG.API_ENDPOINT}/drivers?names=${encodeURIComponent(driverName)}`;
    },
    
    // Make individual API request for a single driver
    async makeIndividualRequest(driverName) {
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

            // Return the driver data (maintaining same API contract as batch requests)
            return apiData;

        } catch (error) {
            // Clear timeout in case of error
            clearTimeout(timeoutId);
            
            // Re-throw error with driver context for retry logic
            error.driverName = driverName;
            throw error;
        }
    },
    
    // Check if error is retryable
    isRetryableError(error) {
        if (!error) {
            return false;
        }
        
        // Network-related errors are retryable
        if (error.name === 'TypeError' && error.message && error.message.includes('fetch')) {
            return true;
        }
        
        // Timeout errors are retryable
        if (error.name === 'AbortError' || (error.message && error.message.includes('timeout'))) {
            return true;
        }
        
        // 5xx server errors are retryable
        if (error.status && error.status >= 500 && error.status < 600) {
            return true;
        }
        
        // 429 Too Many Requests is retryable
        if (error.status === 429) {
            return true;
        }
        
        // All other errors are not retryable (4xx client errors, parsing errors, etc.)
        return false;
    },
    
    // Retry individual request with exponential backoff
    async retryRequest(driverName, error, attempt) {
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
    },
    
    // Main entry point for individual requests with retry logic
    async fetchSingleDriver(driverName) {
        try {
            return await this.makeIndividualRequest(driverName);
        } catch (error) {
            return await this.retryRequest(driverName, error, 1);
        }
    }
};

// Concurrent Request Manager
const ConcurrentRequestManager = {
    MAX_CONCURRENT_REQUESTS: 6, // Browser connection limit consideration
    
    // Track active requests for limiting and cleanup
    activeRequests: new Map(),
    requestQueue: [],
    
    // Request statistics
    stats: {
        totalRequests: 0,
        completedRequests: 0,
        failedRequests: 0,
        concurrentPeakCount: 0,
        averageResponseTime: 0,
        totalResponseTime: 0
    },
    
    // Main entry point for concurrent driver fetching
    async fetchAllDrivers(driverNames) {
        if (!Array.isArray(driverNames) || driverNames.length === 0) {
            console.warn('ConcurrentRequestManager.fetchAllDrivers: Invalid driver names provided');
            return {};
        }
        
        console.log(`Starting concurrent fetch for ${driverNames.length} drivers`);
        this.stats.totalRequests += driverNames.length;
        
        // Create individual request promises for each driver
        const requestPromises = driverNames.map(driverName => 
            this.createManagedRequest(driverName)
        );
        
        // Use Promise.allSettled to handle individual failures without failing the entire batch
        const results = await Promise.allSettled(requestPromises);
        
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
        
        console.log(`Concurrent fetch completed: ${this.stats.completedRequests} successful, ${this.stats.failedRequests} failed`);
        return combinedData;
    },
    
    // Create a managed request that respects concurrency limits
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
            
            // Make the actual request
            const result = await IndividualRequestHandler.fetchSingleDriver(driverName);
            
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
    },
    
    // Wait for an available slot when at concurrency limit
    async waitForSlot() {
        return new Promise((resolve) => {
            const checkSlot = () => {
                if (this.activeRequests.size < this.MAX_CONCURRENT_REQUESTS) {
                    resolve();
                } else {
                    // Check again in 50ms
                    setTimeout(checkSlot, 50);
                }
            };
            checkSlot();
        });
    },
    
    // Process any queued requests (placeholder for future queue implementation)
    processQueue() {
        // Currently using simple waiting mechanism
        // Future enhancement could implement proper request queuing
    },
    
    // Generate unique request ID
    generateRequestId(driverName) {
        return `${driverName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },
    
    // Update response time statistics
    updateResponseTimeStats(responseTime) {
        this.stats.totalResponseTime += responseTime;
        const completedCount = this.stats.completedRequests + 1; // +1 because we haven't incremented completedRequests yet
        this.stats.averageResponseTime = this.stats.totalResponseTime / completedCount;
    },
    
    // Categorize errors for consistent error handling
    categorizeError(error) {
        if (!error) {
            return 'unknown';
        }
        
        // Network-related errors
        if (error.name === 'TypeError' && error.message && error.message.includes('fetch')) {
            return 'network';
        }
        
        // Timeout errors
        if (error.name === 'AbortError' || (error.message && error.message.includes('timeout'))) {
            return 'timeout';
        }
        
        // HTTP errors (API errors)
        if (error.status && (error.status >= 400 && error.status < 600)) {
            return 'api';
        }
        
        // Data parsing errors
        if (error instanceof SyntaxError || (error.message && error.message.includes('JSON'))) {
            return 'data';
        }
        
        // Default to API error for unknown errors
        return 'api';
    },
    
    // Get user-friendly error message
    getErrorMessage(error) {
        const errorType = this.categorizeError(error);
        
        const messages = {
            network: 'Stats unavailable - network error',
            api: 'Stats unavailable - API error',
            data: 'Stats failed to load',
            timeout: 'Stats unavailable - timeout',
            unknown: 'Unable to load stats'
        };
        
        return messages[errorType] || messages.unknown;
    },
    
    // Cancel all pending requests (for cleanup)
    cancelPendingRequests() {
        console.log(`Cancelling ${this.activeRequests.size} pending requests`);
        
        this.activeRequests.forEach((request, requestId) => {
            try {
                request.controller.abort();
                console.log(`Cancelled request for driver: ${request.driverName}`);
            } catch (error) {
                console.warn(`Error cancelling request ${requestId}:`, error);
            }
        });
        
        // Clear all active requests
        this.activeRequests.clear();
        this.requestQueue = [];
        
        console.log('All pending requests cancelled and cleaned up');
    },
    
    // Get current request statistics
    getRequestStats() {
        return {
            ...this.stats,
            activeRequests: this.activeRequests.size,
            queuedRequests: this.requestQueue.length,
            activeDrivers: Array.from(this.activeRequests.values()).map(req => req.driverName)
        };
    },
    
    // Reset statistics (useful for testing)
    resetStats() {
        this.stats = {
            totalRequests: 0,
            completedRequests: 0,
            failedRequests: 0,
            concurrentPeakCount: 0,
            averageResponseTime: 0,
            totalResponseTime: 0
        };
        console.log('Request statistics reset');
    },
    
    // Check if any requests are currently active
    hasActiveRequests() {
        return this.activeRequests.size > 0;
    },
    
    // Get list of currently active driver requests
    getActiveDrivers() {
        return Array.from(this.activeRequests.values()).map(req => req.driverName);
    }
};

// Page Navigation Cleanup Handler
const PageNavigationCleanup = {
    // Track if cleanup handlers are registered
    handlersRegistered: false,
    
    // Register cleanup handlers for page navigation
    registerCleanupHandlers() {
        if (this.handlersRegistered) {
            console.log('Cleanup handlers already registered');
            return;
        }
        
        // Handle page unload (navigation away)
        window.addEventListener('beforeunload', () => {
            console.log('Page unloading - cleaning up concurrent requests');
            ConcurrentRequestManager.cancelPendingRequests();
        });
        
        // Handle page visibility change (tab switching, minimizing)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('Page hidden - cleaning up concurrent requests');
                ConcurrentRequestManager.cancelPendingRequests();
            }
        });
        
        // Handle page focus loss (additional cleanup trigger)
        window.addEventListener('blur', () => {
            // Only cleanup if we have active requests and page is being navigated
            if (ConcurrentRequestManager.hasActiveRequests()) {
                console.log('Window blur with active requests - preparing for cleanup');
                // Small delay to allow for quick refocus
                setTimeout(() => {
                    if (document.hidden || !document.hasFocus()) {
                        console.log('Confirmed navigation - cleaning up requests');
                        ConcurrentRequestManager.cancelPendingRequests();
                    }
                }, 100);
            }
        });
        
        // Handle browser back/forward navigation
        window.addEventListener('popstate', () => {
            console.log('Browser navigation detected - cleaning up requests');
            ConcurrentRequestManager.cancelPendingRequests();
        });
        
        // Handle programmatic navigation (pushState/replaceState)
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(...args) {
            console.log('PushState navigation detected - cleaning up requests');
            ConcurrentRequestManager.cancelPendingRequests();
            return originalPushState.apply(this, args);
        };
        
        history.replaceState = function(...args) {
            console.log('ReplaceState navigation detected - cleaning up requests');
            ConcurrentRequestManager.cancelPendingRequests();
            return originalReplaceState.apply(this, args);
        };
        
        this.handlersRegistered = true;
        console.log('Page navigation cleanup handlers registered');
    },
    
    // Manual cleanup trigger (for testing or explicit cleanup)
    triggerCleanup() {
        console.log('Manual cleanup triggered');
        ConcurrentRequestManager.cancelPendingRequests();
    },
    
    // Check if cleanup handlers are active
    isActive() {
        return this.handlersRegistered;
    }
};

// Enhanced Concurrent Request Manager with improved cleanup
const EnhancedConcurrentRequestManager = {
    ...ConcurrentRequestManager,
    
    // Enhanced initialization with automatic cleanup registration
    initialize() {
        console.log('Initializing Enhanced Concurrent Request Manager');
        
        // Register page navigation cleanup handlers
        PageNavigationCleanup.registerCleanupHandlers();
        
        // Reset statistics
        this.resetStats();
        
        console.log('Enhanced Concurrent Request Manager initialized');
    },
    
    // Enhanced cleanup with memory leak prevention
    cancelPendingRequests() {
        const startTime = Date.now();
        const activeCount = this.activeRequests.size;
        
        console.log(`Enhanced cleanup: Cancelling ${activeCount} pending requests`);
        
        // Cancel all active requests with timeout handling
        const cancelPromises = [];
        
        this.activeRequests.forEach((request, requestId) => {
            const cancelPromise = new Promise((resolve) => {
                try {
                    // Set a timeout for the cancellation itself
                    const cancelTimeout = setTimeout(() => {
                        console.warn(`Cancellation timeout for request ${requestId}`);
                        resolve();
                    }, 1000); // 1 second timeout for cancellation
                    
                    request.controller.abort();
                    
                    // Clear the timeout if cancellation succeeds quickly
                    clearTimeout(cancelTimeout);
                    resolve();
                    
                    console.log(`Cancelled request for driver: ${request.driverName}`);
                } catch (error) {
                    console.warn(`Error cancelling request ${requestId}:`, error);
                    resolve(); // Resolve anyway to prevent hanging
                }
            });
            
            cancelPromises.push(cancelPromise);
        });
        
        // Wait for all cancellations to complete (with overall timeout)
        Promise.allSettled(cancelPromises).then(() => {
            const cleanupTime = Date.now() - startTime;
            console.log(`Cleanup completed in ${cleanupTime}ms`);
        });
        
        // Immediate cleanup of tracking structures
        this.activeRequests.clear();
        this.requestQueue = [];
        
        // Update statistics
        this.stats.failedRequests += activeCount;
        
        console.log(`Enhanced cleanup completed: ${activeCount} requests cancelled`);
    },
    
    // Enhanced request creation with better error handling and cleanup
    async createManagedRequest(driverName) {
        const requestId = this.generateRequestId(driverName);
        const startTime = Date.now();
        
        // Create AbortController for cleanup capability
        const controller = new AbortController();
        
        // Enhanced request tracking with cleanup metadata
        const requestInfo = {
            driverName: driverName,
            startTime: startTime,
            controller: controller,
            requestId: requestId,
            cleanupHandlers: []
        };
        
        // Check if we need to queue this request due to concurrency limits
        if (this.activeRequests.size >= this.MAX_CONCURRENT_REQUESTS) {
            console.log(`Queueing request for driver ${driverName} (${this.activeRequests.size}/${this.MAX_CONCURRENT_REQUESTS} active)`);
            await this.waitForSlot();
        }
        
        // Track this request
        this.activeRequests.set(requestId, requestInfo);
        
        // Update peak concurrent count
        if (this.activeRequests.size > this.stats.concurrentPeakCount) {
            this.stats.concurrentPeakCount = this.activeRequests.size;
        }
        
        // Add abort signal handling for graceful cleanup
        const abortPromise = new Promise((_, reject) => {
            controller.signal.addEventListener('abort', () => {
                const error = new Error('Request cancelled due to page navigation');
                error.name = 'AbortError';
                error.driverName = driverName;
                reject(error);
            });
        });
        
        try {
            console.log(`Starting enhanced request for driver ${driverName} (${this.activeRequests.size}/${this.MAX_CONCURRENT_REQUESTS} active)`);
            
            // Race between the actual request and abort signal
            const result = await Promise.race([
                IndividualRequestHandler.fetchSingleDriver(driverName),
                abortPromise
            ]);
            
            // Calculate response time
            const responseTime = Date.now() - startTime;
            this.updateResponseTimeStats(responseTime);
            
            console.log(`Completed enhanced request for driver ${driverName} in ${responseTime}ms`);
            return result;
            
        } catch (error) {
            const responseTime = Date.now() - startTime;
            
            if (error.name === 'AbortError') {
                console.log(`Request for driver ${driverName} was cancelled after ${responseTime}ms`);
            } else {
                console.error(`Failed enhanced request for driver ${driverName} after ${responseTime}ms:`, error);
            }
            
            throw error;
            
        } finally {
            // Always clean up the request tracking
            this.activeRequests.delete(requestId);
            
            // Run any custom cleanup handlers
            if (requestInfo.cleanupHandlers.length > 0) {
                requestInfo.cleanupHandlers.forEach(handler => {
                    try {
                        handler();
                    } catch (cleanupError) {
                        console.warn('Error in request cleanup handler:', cleanupError);
                    }
                });
            }
            
            // Process any queued requests
            this.processQueue();
        }
    },
    
    // Add custom cleanup handler for a request
    addCleanupHandler(requestId, handler) {
        const request = this.activeRequests.get(requestId);
        if (request && typeof handler === 'function') {
            request.cleanupHandlers.push(handler);
        }
    },
    
    // Get detailed cleanup statistics
    getCleanupStats() {
        return {
            ...this.getRequestStats(),
            cleanupHandlersActive: PageNavigationCleanup.isActive(),
            memoryUsage: {
                activeRequests: this.activeRequests.size,
                queuedRequests: this.requestQueue.length,
                totalTrackedObjects: this.activeRequests.size + this.requestQueue.length
            }
        };
    }
};

// Auto-initialize when script loads
if (typeof window !== 'undefined') {
    // Initialize on DOM ready or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            EnhancedConcurrentRequestManager.initialize();
        });
    } else {
        EnhancedConcurrentRequestManager.initialize();
    }
}

// Export for use in main script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { 
        ConcurrentRequestManager: EnhancedConcurrentRequestManager, 
        IndividualRequestHandler,
        PageNavigationCleanup
    };
}

// Make components available globally for browser environment
if (typeof window !== 'undefined') {
    window.ConcurrentRequestManager = EnhancedConcurrentRequestManager;
    window.IndividualRequestHandler = IndividualRequestHandler;
    window.PageNavigationCleanup = PageNavigationCleanup;
} else if (typeof global !== 'undefined') {
    // For Node.js testing environment
    global.ConcurrentRequestManager = EnhancedConcurrentRequestManager;
    global.IndividualRequestHandler = IndividualRequestHandler;
    global.PageNavigationCleanup = PageNavigationCleanup;
}