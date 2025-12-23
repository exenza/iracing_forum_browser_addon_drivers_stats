// Request Prioritization System for iRacing Forum Browser Extension
// Prioritizes visible drivers over off-screen drivers and handles memory pressure scenarios

const RequestPrioritizer = {
    // Priority levels
    PRIORITY_LEVELS: {
        CRITICAL: 0,    // Visible and in viewport
        HIGH: 1,        // Visible but not in viewport
        MEDIUM: 2,      // Off-screen but on current page
        LOW: 3,         // Background/prefetch requests
        DEFERRED: 4     // Can be delayed under memory pressure
    },
    
    // Configuration
    config: {
        viewportMargin: 100,        // Pixels to extend viewport for priority calculation
        maxConcurrentCritical: 4,   // Max concurrent critical priority requests
        maxConcurrentHigh: 2,       // Max concurrent high priority requests
        maxConcurrentMedium: 1,     // Max concurrent medium priority requests
        memoryPressureThreshold: 50, // MB of memory usage to trigger pressure mode
        deferredRequestDelay: 5000,  // Delay for deferred requests in ms
        visibilityCheckInterval: 1000, // How often to check visibility changes
        enableAdaptivePriority: true   // Enable dynamic priority adjustment
    },
    
    // Request queues by priority
    requestQueues: {
        [0]: [], // CRITICAL
        [1]: [], // HIGH
        [2]: [], // MEDIUM
        [3]: [], // LOW
        [4]: []  // DEFERRED
    },
    
    // Active requests by priority
    activeRequests: {
        [0]: new Set(), // CRITICAL
        [1]: new Set(), // HIGH
        [2]: new Set(), // MEDIUM
        [3]: new Set(), // LOW
        [4]: new Set()  // DEFERRED
    },
    
    // Driver element tracking for visibility
    driverElements: new Map(),
    
    // Memory pressure monitoring
    memoryMonitor: {
        isUnderPressure: false,
        lastCheck: 0,
        checkInterval: 5000, // Check every 5 seconds
        pressureStartTime: null
    },
    
    // Visibility observer
    intersectionObserver: null,
    
    // Initialize the prioritization system
    initialize() {
        console.log('RequestPrioritizer: Initializing request prioritization system');
        
        // Initialize intersection observer for visibility tracking
        this.initializeVisibilityObserver();
        
        // Start memory monitoring
        this.startMemoryMonitoring();
        
        // Start periodic priority adjustment
        if (this.config.enableAdaptivePriority) {
            this.startAdaptivePriorityAdjustment();
        }
        
        // Register cleanup handlers
        this.registerCleanupHandlers();
        
        console.log('RequestPrioritizer: Prioritization system initialized');
    },
    
    // Initialize intersection observer for visibility tracking
    initializeVisibilityObserver() {
        if (!window.IntersectionObserver) {
            console.warn('RequestPrioritizer: IntersectionObserver not supported, using fallback visibility detection');
            return;
        }
        
        const options = {
            root: null, // Use viewport as root
            rootMargin: `${this.config.viewportMargin}px`,
            threshold: [0, 0.1, 0.5, 1.0] // Multiple thresholds for better tracking
        };
        
        this.intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const element = entry.target;
                const driverName = element.getAttribute('data-driver-name');
                
                if (driverName) {
                    this.updateDriverVisibility(driverName, entry.isIntersecting, entry.intersectionRatio);
                }
            });
        }, options);
        
        console.log('RequestPrioritizer: Intersection observer initialized');
    },
    
    // Register a driver element for visibility tracking
    registerDriverElement(driverName, element) {
        if (!driverName || !element) {
            console.warn('RequestPrioritizer.registerDriverElement: Missing required parameters');
            return false;
        }
        
        // Store element reference
        this.driverElements.set(driverName, {
            element: element,
            isVisible: false,
            intersectionRatio: 0,
            lastVisibilityCheck: Date.now(),
            priority: this.PRIORITY_LEVELS.MEDIUM // Default priority
        });
        
        // Add data attribute for tracking
        element.setAttribute('data-driver-name', driverName);
        
        // Start observing if intersection observer is available
        if (this.intersectionObserver) {
            this.intersectionObserver.observe(element);
        } else {
            // Fallback: check visibility manually
            this.checkElementVisibilityFallback(driverName, element);
        }
        
        console.log(`RequestPrioritizer: Registered driver element: ${driverName}`);
        return true;
    },
    
    // Update driver visibility status
    updateDriverVisibility(driverName, isVisible, intersectionRatio = 0) {
        const driverInfo = this.driverElements.get(driverName);
        if (!driverInfo) {
            return;
        }
        
        const wasVisible = driverInfo.isVisible;
        driverInfo.isVisible = isVisible;
        driverInfo.intersectionRatio = intersectionRatio;
        driverInfo.lastVisibilityCheck = Date.now();
        
        // Update priority based on visibility
        const newPriority = this.calculateDriverPriority(driverName, isVisible, intersectionRatio);
        const oldPriority = driverInfo.priority;
        driverInfo.priority = newPriority;
        
        // Log visibility changes
        if (wasVisible !== isVisible || oldPriority !== newPriority) {
            console.log(`RequestPrioritizer: Driver ${driverName} visibility changed - visible: ${isVisible}, ratio: ${intersectionRatio.toFixed(2)}, priority: ${this.getPriorityName(newPriority)}`);
            
            // Trigger priority rebalancing if needed
            if (oldPriority !== newPriority) {
                this.rebalanceRequestPriorities();
            }
        }
    },
    
    // Calculate driver priority based on visibility and other factors
    calculateDriverPriority(driverName, isVisible, intersectionRatio) {
        // Critical: Fully visible in viewport
        if (isVisible && intersectionRatio >= 0.5) {
            return this.PRIORITY_LEVELS.CRITICAL;
        }
        
        // High: Partially visible or just outside viewport
        if (isVisible && intersectionRatio > 0) {
            return this.PRIORITY_LEVELS.HIGH;
        }
        
        // Medium: On page but not visible
        if (!isVisible) {
            // Check if element is on current page
            const driverInfo = this.driverElements.get(driverName);
            if (driverInfo && driverInfo.element && document.contains(driverInfo.element)) {
                return this.PRIORITY_LEVELS.MEDIUM;
            }
        }
        
        // Low: Background requests
        return this.PRIORITY_LEVELS.LOW;
    },
    
    // Fallback visibility check for browsers without IntersectionObserver
    checkElementVisibilityFallback(driverName, element) {
        if (!element || !document.contains(element)) {
            return;
        }
        
        const rect = element.getBoundingClientRect();
        const viewport = {
            top: -this.config.viewportMargin,
            left: -this.config.viewportMargin,
            bottom: window.innerHeight + this.config.viewportMargin,
            right: window.innerWidth + this.config.viewportMargin
        };
        
        const isVisible = (
            rect.bottom > viewport.top &&
            rect.top < viewport.bottom &&
            rect.right > viewport.left &&
            rect.left < viewport.right
        );
        
        // Calculate approximate intersection ratio
        const intersectionRatio = isVisible ? Math.min(
            (Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top)) /
            (rect.bottom - rect.top),
            1.0
        ) : 0;
        
        this.updateDriverVisibility(driverName, isVisible, intersectionRatio);
    },
    
    // Create a prioritized request
    createPrioritizedRequest(driverName, requestFactory, options = {}) {
        const priority = this.getDriverPriority(driverName);
        const requestId = this.generateRequestId(driverName);
        
        const prioritizedRequest = {
            requestId: requestId,
            driverName: driverName,
            priority: priority,
            requestFactory: requestFactory,
            createdAt: Date.now(),
            attempts: 0,
            options: {
                canDefer: options.canDefer !== false, // Default to true
                maxRetries: options.maxRetries || 3,
                timeout: options.timeout || 10000,
                ...options
            }
        };
        
        // Add to appropriate queue
        this.requestQueues[priority].push(prioritizedRequest);
        
        console.log(`RequestPrioritizer: Created ${this.getPriorityName(priority)} priority request for driver: ${driverName}`);
        
        // Process queue
        this.processRequestQueues();
        
        return requestId;
    },
    
    // Get driver priority
    getDriverPriority(driverName) {
        const driverInfo = this.driverElements.get(driverName);
        if (driverInfo) {
            return driverInfo.priority;
        }
        
        // Default priority for unregistered drivers
        return this.PRIORITY_LEVELS.MEDIUM;
    },
    
    // Process request queues based on priority and concurrency limits
    async processRequestQueues() {
        // Check memory pressure first
        if (this.shouldDeferRequests()) {
            console.log('RequestPrioritizer: Deferring requests due to memory pressure');
            return;
        }
        
        // Process queues in priority order
        for (let priority = 0; priority < Object.keys(this.requestQueues).length; priority++) {
            const queue = this.requestQueues[priority];
            const activeSet = this.activeRequests[priority];
            const maxConcurrent = this.getMaxConcurrentForPriority(priority);
            
            // Process requests if under limit and queue has items
            while (queue.length > 0 && activeSet.size < maxConcurrent) {
                const request = queue.shift();
                
                // Check if request should be deferred
                if (this.shouldDeferRequest(request)) {
                    // Move to deferred queue
                    this.requestQueues[this.PRIORITY_LEVELS.DEFERRED].push(request);
                    continue;
                }
                
                // Execute request
                this.executeRequest(request);
            }
        }
        
        // Process deferred requests if conditions allow
        this.processDeferredRequests();
    },
    
    // Execute a prioritized request
    async executeRequest(request) {
        const { requestId, driverName, priority, requestFactory } = request;
        
        // Add to active requests
        this.activeRequests[priority].add(requestId);
        
        console.log(`RequestPrioritizer: Executing ${this.getPriorityName(priority)} priority request for driver: ${driverName}`);
        
        try {
            // Execute the request factory
            const result = await requestFactory(driverName);
            
            console.log(`RequestPrioritizer: Completed ${this.getPriorityName(priority)} priority request for driver: ${driverName}`);
            
            // Update performance metrics if available
            if (typeof PerformanceMonitor !== 'undefined') {
                PerformanceMonitor.log('info', `Prioritized request completed: ${driverName} (${this.getPriorityName(priority)} priority)`);
            }
            
            return result;
            
        } catch (error) {
            console.error(`RequestPrioritizer: Failed ${this.getPriorityName(priority)} priority request for driver: ${driverName}`, error);
            
            // Handle retry logic
            if (request.attempts < request.options.maxRetries && this.shouldRetryRequest(request, error)) {
                request.attempts++;
                
                // Add back to queue with exponential backoff
                const delay = 1000 * Math.pow(2, request.attempts - 1);
                setTimeout(() => {
                    this.requestQueues[priority].push(request);
                    this.processRequestQueues();
                }, delay);
                
                console.log(`RequestPrioritizer: Retrying request for driver: ${driverName} (attempt ${request.attempts})`);
            }
            
            throw error;
            
        } finally {
            // Remove from active requests
            this.activeRequests[priority].delete(requestId);
            
            // Continue processing queue
            setTimeout(() => this.processRequestQueues(), 0);
        }
    },
    
    // Get maximum concurrent requests for priority level
    getMaxConcurrentForPriority(priority) {
        switch (priority) {
            case this.PRIORITY_LEVELS.CRITICAL:
                return this.config.maxConcurrentCritical;
            case this.PRIORITY_LEVELS.HIGH:
                return this.config.maxConcurrentHigh;
            case this.PRIORITY_LEVELS.MEDIUM:
                return this.config.maxConcurrentMedium;
            case this.PRIORITY_LEVELS.LOW:
                return 1;
            case this.PRIORITY_LEVELS.DEFERRED:
                return this.memoryMonitor.isUnderPressure ? 0 : 1;
            default:
                return 1;
        }
    },
    
    // Check if requests should be deferred due to memory pressure
    shouldDeferRequests() {
        this.checkMemoryPressure();
        return this.memoryMonitor.isUnderPressure;
    },
    
    // Check if specific request should be deferred
    shouldDeferRequest(request) {
        // Don't defer critical or high priority requests
        if (request.priority <= this.PRIORITY_LEVELS.HIGH) {
            return false;
        }
        
        // Defer if under memory pressure and request allows deferring
        if (this.memoryMonitor.isUnderPressure && request.options.canDefer) {
            return true;
        }
        
        // Defer old low priority requests
        const age = Date.now() - request.createdAt;
        if (request.priority === this.PRIORITY_LEVELS.LOW && age > 30000) { // 30 seconds
            return true;
        }
        
        return false;
    },
    
    // Process deferred requests when conditions improve
    processDeferredRequests() {
        if (this.memoryMonitor.isUnderPressure) {
            return; // Still under pressure
        }
        
        const deferredQueue = this.requestQueues[this.PRIORITY_LEVELS.DEFERRED];
        const maxToProcess = 2; // Process a few at a time
        
        for (let i = 0; i < Math.min(maxToProcess, deferredQueue.length); i++) {
            const request = deferredQueue.shift();
            
            // Add back to original priority queue
            this.requestQueues[request.priority].push(request);
            
            console.log(`RequestPrioritizer: Restored deferred request for driver: ${request.driverName}`);
        }
        
        if (deferredQueue.length > 0) {
            // Schedule next batch
            setTimeout(() => this.processDeferredRequests(), this.config.deferredRequestDelay);
        }
    },
    
    // Check memory pressure
    checkMemoryPressure() {
        const now = Date.now();
        if (now - this.memoryMonitor.lastCheck < this.memoryMonitor.checkInterval) {
            return; // Too soon to check again
        }
        
        this.memoryMonitor.lastCheck = now;
        
        // Check if memory API is available
        if (performance.memory) {
            const memoryUsage = performance.memory.usedJSHeapSize / (1024 * 1024); // MB
            const wasUnderPressure = this.memoryMonitor.isUnderPressure;
            
            this.memoryMonitor.isUnderPressure = memoryUsage > this.config.memoryPressureThreshold;
            
            if (this.memoryMonitor.isUnderPressure && !wasUnderPressure) {
                this.memoryMonitor.pressureStartTime = now;
                console.warn(`RequestPrioritizer: Memory pressure detected (${memoryUsage.toFixed(1)}MB used)`);
                
                // Trigger garbage collection if available
                if (window.gc) {
                    window.gc();
                }
                
            } else if (!this.memoryMonitor.isUnderPressure && wasUnderPressure) {
                const pressureDuration = now - (this.memoryMonitor.pressureStartTime || now);
                console.log(`RequestPrioritizer: Memory pressure relieved after ${pressureDuration}ms (${memoryUsage.toFixed(1)}MB used)`);
                this.memoryMonitor.pressureStartTime = null;
            }
        } else {
            // Fallback: assume no memory pressure if API not available
            this.memoryMonitor.isUnderPressure = false;
        }
    },
    
    // Start memory monitoring
    startMemoryMonitoring() {
        this.memoryCheckInterval = setInterval(() => {
            this.checkMemoryPressure();
        }, this.memoryMonitor.checkInterval);
        
        console.log('RequestPrioritizer: Memory monitoring started');
    },
    
    // Start adaptive priority adjustment
    startAdaptivePriorityAdjustment() {
        this.priorityAdjustmentInterval = setInterval(() => {
            this.adjustPrioritiesBasedOnPerformance();
        }, this.config.visibilityCheckInterval);
        
        console.log('RequestPrioritizer: Adaptive priority adjustment started');
    },
    
    // Adjust priorities based on performance metrics
    adjustPrioritiesBasedOnPerformance() {
        // Check if performance monitor is available
        if (typeof PerformanceMonitor === 'undefined') {
            return;
        }
        
        const metrics = PerformanceMonitor.getMetricsSnapshot();
        
        // Adjust concurrency limits based on performance
        if (metrics.requestTiming.averageResponseTime > 5000) { // 5 seconds
            // Slow responses - reduce concurrency
            this.config.maxConcurrentCritical = Math.max(2, this.config.maxConcurrentCritical - 1);
            this.config.maxConcurrentHigh = Math.max(1, this.config.maxConcurrentHigh - 1);
            
            console.log('RequestPrioritizer: Reduced concurrency due to slow responses');
            
        } else if (metrics.requestTiming.averageResponseTime < 1000) { // 1 second
            // Fast responses - can increase concurrency
            this.config.maxConcurrentCritical = Math.min(6, this.config.maxConcurrentCritical + 1);
            this.config.maxConcurrentHigh = Math.min(4, this.config.maxConcurrentHigh + 1);
            
            console.log('RequestPrioritizer: Increased concurrency due to fast responses');
        }
        
        // Adjust memory pressure threshold based on error rates
        const errorRate = metrics.requestTiming.failedRequests / Math.max(1, metrics.requestTiming.totalRequests);
        if (errorRate > 0.2) { // 20% error rate
            this.config.memoryPressureThreshold = Math.max(30, this.config.memoryPressureThreshold - 5);
            console.log('RequestPrioritizer: Lowered memory pressure threshold due to high error rate');
        }
    },
    
    // Rebalance request priorities when visibility changes
    rebalanceRequestPriorities() {
        let rebalanced = 0;
        
        // Check all queued requests and update their priorities
        Object.keys(this.requestQueues).forEach(priority => {
            const queue = this.requestQueues[priority];
            const toRebalance = [];
            
            // Find requests that need priority adjustment
            for (let i = queue.length - 1; i >= 0; i--) {
                const request = queue[i];
                const currentPriority = this.getDriverPriority(request.driverName);
                
                if (currentPriority !== parseInt(priority)) {
                    toRebalance.push(queue.splice(i, 1)[0]);
                }
            }
            
            // Move requests to correct priority queues
            toRebalance.forEach(request => {
                const newPriority = this.getDriverPriority(request.driverName);
                request.priority = newPriority;
                this.requestQueues[newPriority].push(request);
                rebalanced++;
            });
        });
        
        if (rebalanced > 0) {
            console.log(`RequestPrioritizer: Rebalanced ${rebalanced} requests based on visibility changes`);
            this.processRequestQueues();
        }
    },
    
    // Check if request should be retried
    shouldRetryRequest(request, error) {
        // Don't retry client errors (4xx)
        if (error.status && error.status >= 400 && error.status < 500) {
            return false;
        }
        
        // Retry network and server errors
        return true;
    },
    
    // Get priority name for logging
    getPriorityName(priority) {
        const names = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'DEFERRED'];
        return names[priority] || 'UNKNOWN';
    },
    
    // Generate unique request ID
    generateRequestId(driverName) {
        return `${driverName}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    },
    
    // Get current prioritization statistics
    getStats() {
        const queueSizes = {};
        const activeSizes = {};
        
        Object.keys(this.requestQueues).forEach(priority => {
            queueSizes[this.getPriorityName(priority)] = this.requestQueues[priority].length;
            activeSizes[this.getPriorityName(priority)] = this.activeRequests[priority].size;
        });
        
        return {
            queueSizes: queueSizes,
            activeSizes: activeSizes,
            totalQueued: Object.values(this.requestQueues).reduce((sum, queue) => sum + queue.length, 0),
            totalActive: Object.values(this.activeRequests).reduce((sum, set) => sum + set.size, 0),
            registeredDrivers: this.driverElements.size,
            visibleDrivers: Array.from(this.driverElements.values()).filter(info => info.isVisible).length,
            memoryPressure: this.memoryMonitor.isUnderPressure,
            memoryUsage: performance.memory ? (performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1) + 'MB' : 'N/A'
        };
    },
    
    // Log current statistics
    logStats() {
        const stats = this.getStats();
        console.log('=== Request Prioritization Statistics ===');
        console.log('Queue Sizes:', stats.queueSizes);
        console.log('Active Requests:', stats.activeSizes);
        console.log(`Total: ${stats.totalQueued} queued, ${stats.totalActive} active`);
        console.log(`Drivers: ${stats.registeredDrivers} registered, ${stats.visibleDrivers} visible`);
        console.log(`Memory: ${stats.memoryUsage}, Pressure: ${stats.memoryPressure}`);
        console.log('=== End Statistics ===');
    },
    
    // Register cleanup handlers
    registerCleanupHandlers() {
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
        
        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('RequestPrioritizer: Page hidden - pausing prioritization');
            } else {
                console.log('RequestPrioritizer: Page visible - resuming prioritization');
                // Recheck all driver visibilities
                this.recheckAllVisibilities();
            }
        });
        
        // Handle scroll events for visibility updates
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if (!this.intersectionObserver) {
                    this.recheckAllVisibilities();
                }
            }, 100);
        });
    },
    
    // Recheck all driver visibilities (fallback method)
    recheckAllVisibilities() {
        this.driverElements.forEach((driverInfo, driverName) => {
            if (driverInfo.element) {
                this.checkElementVisibilityFallback(driverName, driverInfo.element);
            }
        });
    },
    
    // Cleanup and finalize
    cleanup() {
        console.log('RequestPrioritizer: Cleaning up prioritization system');
        
        // Stop intervals
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
        }
        
        if (this.priorityAdjustmentInterval) {
            clearInterval(this.priorityAdjustmentInterval);
        }
        
        // Disconnect intersection observer
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
        }
        
        // Clear queues
        Object.keys(this.requestQueues).forEach(priority => {
            this.requestQueues[priority] = [];
        });
        
        // Clear active requests
        Object.keys(this.activeRequests).forEach(priority => {
            this.activeRequests[priority].clear();
        });
        
        // Clear driver elements
        this.driverElements.clear();
        
        console.log('RequestPrioritizer: Cleanup completed');
    }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.RequestPrioritizer = RequestPrioritizer;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RequestPrioritizer };
}