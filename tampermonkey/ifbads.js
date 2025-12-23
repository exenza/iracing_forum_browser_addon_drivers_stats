// ==UserScript==
// @name         iR Forum user stats
// @namespace    http://tampermonkey.net/
// @version      2.0_2025-12-23
// @description  Show user stats in the iRacing forum
// @author       MR
// @match        https://forums.iracing.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @downloadURL  https://raw.githubusercontent.com/exenza/iracing_forum_browser_addon_drivers_stats/refs/heads/main/tampermonkey/ifbads.js?token=$(date%20+%s)
// @updateURL    https://raw.githubusercontent.com/exenza/iracing_forum_browser_addon_drivers_stats/refs/heads/main/tampermonkey/ifbads.js?token=$(date%20+%s)
// ==/UserScript==

// NOTE: For task 9.1 implementation, ensure request-metrics-logger.js is loaded before this script

// Configuration
const CONFIG = {
    // API Configuration
    API_ENDPOINT: 'https://ncv5ut7oz0.execute-api.eu-central-1.amazonaws.com/dev',

    // User Settings
    show_cpi: 1, // 0: off, 1: on
    sort_licenses: 1, // 0: off, 1: sort_lic_default, 2: iRating, 3: CPI, 4: iRating and CPI
    sort_lic_default: {
        sports_car: 5,
        formula_car: 4,
        oval: 3,
        dirt_oval: 2,
        dirt_road: 1,
        undefined: 0,
    },
    show_max_recent_events: 5,
    show_max_recent_cars: 5,
    show_recent_type: {
        race: 1, // 0: off, 1: on
        hosted: 1, // 0: off, 1: on, 2: only if no more major event
        league: 1, // 0: off, 1: on, 2: only if no more major event
        qualify: 2, // 0: off, 1: on, 2: only if no more major event
        practice: 2, // 0: off, 1: on, 2: only if no more major event
        timetrial: 1, // 0: off, 1: on, 2: only if no more major event
    }
};

// Legacy config variables for backward compatibility
const show_cpi = CONFIG.show_cpi;
const sort_licenses = CONFIG.sort_licenses;
const sort_lic_default = CONFIG.sort_lic_default;
const show_max_recent_events = CONFIG.show_max_recent_events;
const show_max_recent_cars = CONFIG.show_max_recent_cars;
const show_recent_type = CONFIG.show_recent_type;

// ===== CONCURRENT LOADING COMPONENTS =====
// These components implement concurrent individual driver requests to replace batch API calls

// Individual Request Handler for single driver API requests
const IndividualRequestHandler = {
    TIMEOUT_MS: 10000, // 10 seconds per request
    MAX_RETRIES: 3,

    // Create individual API URL for a single driver
    createRequestUrl(driverName) {
        return `${CONFIG.API_ENDPOINT}/drivers?names=${encodeURIComponent(driverName)}`;
    },

    // Make individual API request for a single driver
    async makeIndividualRequest(driverName) {
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

            clearTimeout(timeoutId);

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                throw error;
            }

            const apiData = await response.json();

            if (!apiData || typeof apiData !== 'object') {
                throw new Error('Invalid API response format');
            }

            return apiData;

        } catch (error) {
            clearTimeout(timeoutId);
            error.driverName = driverName;
            throw error;
        }
    },

    // Check if error is retryable
    isRetryableError(error) {
        if (!error) return false;

        if (error.name === 'TypeError' && error.message && error.message.includes('fetch')) {
            return true;
        }

        if (error.name === 'AbortError' || (error.message && error.message.includes('timeout'))) {
            return true;
        }

        if (error.status && error.status >= 500 && error.status < 600) {
            return true;
        }

        if (error.status === 429) {
            return true;
        }

        return false;
    },

    // Retry individual request with exponential backoff
    async retryRequest(driverName, error, attempt) {
        if (!this.isRetryableError(error) || attempt >= this.MAX_RETRIES) {
            throw error;
        }

        const delay = 1000 * Math.pow(2, attempt - 1);
        console.warn(`Attempt ${attempt} failed for driver ${driverName}. Retrying in ${delay}ms...`);

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

// Concurrent Request Manager for managing multiple individual requests
const ConcurrentRequestManager = {
    MAX_CONCURRENT_REQUESTS: 6, // Browser connection limit consideration

    activeRequests: new Map(),
    requestQueue: [],

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

        const requestPromises = driverNames.map(driverName =>
            this.createManagedRequest(driverName)
        );

        const results = await Promise.allSettled(requestPromises);

        const combinedData = {};

        results.forEach((result, index) => {
            const driverName = driverNames[index];

            if (result.status === 'fulfilled') {
                if (result.value && typeof result.value === 'object') {
                    Object.assign(combinedData, result.value);
                    this.stats.completedRequests++;
                } else {
                    combinedData[driverName] = {
                        error: true,
                        errorType: 'data',
                        errorMessage: 'Invalid response format',
                        driverName: driverName
                    };
                    this.stats.failedRequests++;
                }
            } else {
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
        if (this.activeRequests.size >= this.MAX_CONCURRENT_REQUESTS) {
            console.log(`Queueing request for driver ${driverName} (${this.activeRequests.size}/${this.MAX_CONCURRENT_REQUESTS} active)`);
            await this.waitForSlot();
        }

        const requestId = this.generateRequestId(driverName);
        const startTime = Date.now();
        const controller = new AbortController();

        this.activeRequests.set(requestId, {
            driverName: driverName,
            startTime: startTime,
            controller: controller
        });

        if (this.activeRequests.size > this.stats.concurrentPeakCount) {
            this.stats.concurrentPeakCount = this.activeRequests.size;
        }

        try {
            console.log(`Starting request for driver ${driverName} (${this.activeRequests.size}/${this.MAX_CONCURRENT_REQUESTS} active)`);

            const result = await IndividualRequestHandler.fetchSingleDriver(driverName);

            const responseTime = Date.now() - startTime;
            this.updateResponseTimeStats(responseTime);

            console.log(`Completed request for driver ${driverName} in ${responseTime}ms`);
            return result;

        } catch (error) {
            const responseTime = Date.now() - startTime;
            console.error(`Failed request for driver ${driverName} after ${responseTime}ms:`, error);
            throw error;

        } finally {
            this.activeRequests.delete(requestId);
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
                    setTimeout(checkSlot, 50);
                }
            };
            checkSlot();
        });
    },

    processQueue() {
        // Currently using simple waiting mechanism
    },

    generateRequestId(driverName) {
        return `${driverName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },

    updateResponseTimeStats(responseTime) {
        this.stats.totalResponseTime += responseTime;
        const completedCount = this.stats.completedRequests + 1;
        this.stats.averageResponseTime = this.stats.totalResponseTime / completedCount;
    },

    categorizeError(error) {
        if (!error) return 'unknown';

        if (error.name === 'TypeError' && error.message && error.message.includes('fetch')) {
            return 'network';
        }

        if (error.name === 'AbortError' || (error.message && error.message.includes('timeout'))) {
            return 'timeout';
        }

        if (error.status && (error.status >= 400 && error.status < 600)) {
            return 'api';
        }

        if (error instanceof SyntaxError || (error.message && error.message.includes('JSON'))) {
            return 'data';
        }

        return 'api';
    },

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

        this.activeRequests.clear();
        this.requestQueue = [];

        console.log('All pending requests cancelled and cleaned up');
    },

    // Initialize the concurrent request manager
    initialize() {
        console.log('Initializing Concurrent Request Manager');
        this.resetStats();
        console.log('Concurrent Request Manager initialized');
    },

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

    hasActiveRequests() {
        return this.activeRequests.size > 0;
    },

    getActiveDrivers() {
        return Array.from(this.activeRequests.values()).map(req => req.driverName);
    }
};

// Progressive Display Manager for immediate rendering of individual driver stats
const ProgressiveDisplayManager = {
    driverElementMap: new Map(),
    completionStatus: new Map(),
    loadingStates: new Map(),

    // Display driver stats immediately when individual request completes
    displayDriverStats(driverName, driverData) {
        if (!driverName || !driverData) {
            console.warn('ProgressiveDisplayManager.displayDriverStats: Missing required parameters');
            return false;
        }

        console.log(`Progressive display: Rendering stats for driver ${driverName}`);

        const elements = this.getElementsForDriver(driverName);

        if (elements.length === 0) {
            console.warn(`ProgressiveDisplayManager.displayDriverStats: No elements found for driver ${driverName}`);
            return false;
        }

        let successCount = 0;

        elements.forEach(element => {
            try {
                if (driverData[driverName] && driverData[driverName].member_info) {
                    this.renderDriverStatsToElement(element, driverName, driverData[driverName]);
                    successCount++;
                } else {
                    console.warn(`Progressive display: Invalid data structure for driver ${driverName}`);
                    this.displayDriverError(driverName, 'Stats failed to load');
                }
            } catch (error) {
                console.error(`Progressive display: Error rendering driver ${driverName}:`, error);
                this.displayDriverError(driverName, 'Stats failed to load');
            }
        });

        this.markDriverComplete(driverName);

        console.log(`Progressive display: Successfully rendered ${successCount} elements for driver ${driverName}`);
        return successCount > 0;
    },

    // Display error message for individual driver
    displayDriverError(driverName, errorMessage) {
        if (!driverName || !errorMessage) {
            console.warn('ProgressiveDisplayManager.displayDriverError: Missing required parameters');
            return false;
        }

        console.log(`Progressive display: Showing error for driver ${driverName}: ${errorMessage}`);

        const elements = this.getElementsForDriver(driverName);

        if (elements.length === 0) {
            console.warn(`ProgressiveDisplayManager.displayDriverError: No elements found for driver ${driverName}`);
            return false;
        }

        let errorCount = 0;

        elements.forEach(element => {
            try {
                if (typeof LoadingManager !== 'undefined' && LoadingManager.showErrorForElement) {
                    LoadingManager.showErrorForElement(element, errorMessage);
                    errorCount++;
                } else {
                    element.innerHTML = `<span class="error-message fs90">${errorMessage}</span>`;
                    errorCount++;
                }
            } catch (error) {
                console.error(`Progressive display: Error showing error for driver ${driverName}:`, error);
            }
        });

        this.markDriverComplete(driverName, true);

        console.log(`Progressive display: Showed error for ${errorCount} elements of driver ${driverName}`);
        return errorCount > 0;
    },

    // Associate driver name with DOM elements
    associateDriverWithElements(driverName, elements) {
        if (!driverName) {
            console.warn('ProgressiveDisplayManager.associateDriverWithElements: Missing driver name');
            return false;
        }

        const elementArray = Array.isArray(elements) ? elements : [elements].filter(Boolean);

        if (elementArray.length === 0) {
            console.warn(`ProgressiveDisplayManager.associateDriverWithElements: No valid elements for driver ${driverName}`);
            return false;
        }

        const existingElements = this.driverElementMap.get(driverName) || [];

        elementArray.forEach(element => {
            if (element && !existingElements.includes(element)) {
                existingElements.push(element);
            }
        });

        this.driverElementMap.set(driverName, existingElements);

        console.log(`Progressive display: Associated driver ${driverName} with ${existingElements.length} elements`);
        return true;
    },

    getElementsForDriver(driverName) {
        return this.driverElementMap.get(driverName) || [];
    },

    markDriverComplete(driverName, hasError = false) {
        this.completionStatus.set(driverName, {
            completed: true,
            hasError: hasError,
            completedAt: Date.now()
        });

        this.loadingStates.delete(driverName);

        console.log(`Progressive display: Marked driver ${driverName} as ${hasError ? 'completed with error' : 'completed successfully'}`);
    },

    isDriverComplete(driverName) {
        const status = this.completionStatus.get(driverName);
        return status ? status.completed : false;
    },

    // Render driver stats to specific element
    renderDriverStatsToElement(element, driverName, driverData) {
        if (!element || !driverName || !driverData) {
            console.warn('ProgressiveDisplayManager.renderDriverStatsToElement: Missing required parameters');
            return false;
        }

        try {
            if (!driverData.member_info) {
                console.warn(`Progressive display: No member_info for driver ${driverName}`);
                this.displayDriverError(driverName, 'Stats failed to load');
                return false;
            }

            const member = driverData.member_info;

            let driver_stats = '';

            if (member.display_name) {
                driver_stats += `<div class="driver-name">${member.display_name}</div>`;
            }

            if (member.irating) {
                driver_stats += `<div class="irating">iRating: ${member.irating}</div>`;
            }

            if (member.license) {
                const license = member.license;
                if (license.license_level !== undefined) {
                    driver_stats += `<div class="license">License: ${license.license_level}</div>`;
                }
            }

            if (member.member_since) {
                const memberSince = new Date(member.member_since);
                const years = Math.floor((Date.now() - memberSince.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
                driver_stats += `<div class="member-since">Member: ${years} years</div>`;
            }

            const statsHtml = `<div id="driver_infos" class="fwb fs12">${driver_stats}</div>`;

            if (typeof LoadingManager !== 'undefined' && LoadingManager.hideLoadingForElement) {
                LoadingManager.hideLoadingForElement(element, statsHtml);
            } else {
                element.innerHTML = statsHtml;
            }

            console.log(`Progressive display: Successfully rendered stats for driver ${driverName}`);
            return true;

        } catch (error) {
            console.error(`Progressive display: Error rendering driver ${driverName}:`, error);
            this.displayDriverError(driverName, 'Stats failed to load');
            return false;
        }
    },

    // Clean up all progressive display state
    cleanup() {
        this.driverElementMap.clear();
        this.completionStatus.clear();
        this.loadingStates.clear();
        console.log('ProgressiveDisplayManager: Cleaned up all progressive display state');
    },

    // Initialize progressive display system
    initialize() {
        console.log('ProgressiveDisplayManager: Initializing progressive display system');
        this.cleanup();
        console.log('ProgressiveDisplayManager: Progressive display system initialized');
    }
};

// ===== END CONCURRENT LOADING COMPONENTS =====

// Error Handler for managing API failures and user feedback
const ErrorHandler = {
    // Error types for categorization
    ERROR_TYPES: {
        NETWORK: 'network',
        API: 'api',
        DATA: 'data',
        TIMEOUT: 'timeout'
    },

    // User-friendly error messages
    ERROR_MESSAGES: {
        network: 'Stats unavailable - network error',
        api: 'Stats unavailable - API error',
        data: 'Stats failed to load',
        timeout: 'Stats unavailable - timeout',
        generic: 'Unable to load stats'
    },

    // Individual driver error tracking for concurrent requests
    driverErrors: new Map(),

    // Concurrent request success/failure metrics
    concurrentMetrics: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        driversWithErrors: new Set(),
        successfulDrivers: new Set(),
        errorBreakdown: {
            network: 0,
            api: 0,
            data: 0,
            timeout: 0
        },
        lastRequestTime: 0,
        averageResponseTime: 0,
        requestTimes: []
    },

    // Handle different types of errors (enhanced for individual drivers)
    handleApiError(error, driverName = null) {
        const errorType = this.categorizeError(error);
        const message = this.getErrorMessage(errorType);

        const errorInfo = {
            type: errorType,
            message: message,
            driverName: driverName,
            timestamp: new Date().toISOString(),
            originalError: error
        };

        this.logError(error, {
            type: errorType,
            driverName: driverName,
            timestamp: errorInfo.timestamp
        });

        // Track individual driver errors for concurrent request metrics
        if (driverName) {
            this.trackIndividualDriverError(driverName, errorInfo);
        }

        return errorInfo;
    },

    // Handle individual driver error (for concurrent loading)
    handleIndividualDriverError(error, driverName) {
        if (!driverName) {
            console.warn('ErrorHandler.handleIndividualDriverError: Missing driver name');
            return null;
        }

        const errorInfo = this.handleApiError(error, driverName);

        // Update concurrent request metrics
        this.updateConcurrentMetrics('error', driverName, errorInfo.type);

        return errorInfo;
    },

    // Mark driver as successful (for concurrent request metrics)
    markDriverSuccess(driverName, responseTime = 0) {
        if (!driverName) {
            return;
        }

        this.concurrentMetrics.successfulDrivers.add(driverName);
        this.updateConcurrentMetrics('success', driverName, null, responseTime);

        console.log(`ErrorHandler: Marked driver ${driverName} as successful (${responseTime}ms)`);
    },

    // Track individual driver error for metrics
    trackIndividualDriverError(driverName, errorInfo) {
        this.driverErrors.set(driverName, errorInfo);
        this.concurrentMetrics.driversWithErrors.add(driverName);

        console.log(`ErrorHandler: Tracked error for driver ${driverName}: ${errorInfo.type}`);
    },

    // Update concurrent request metrics
    updateConcurrentMetrics(type, driverName, errorType = null, responseTime = 0) {
        if (type === 'success') {
            this.concurrentMetrics.successfulRequests++;
            if (responseTime > 0) {
                this.concurrentMetrics.requestTimes.push(responseTime);
                // Keep only last 100 response times for average calculation
                if (this.concurrentMetrics.requestTimes.length > 100) {
                    this.concurrentMetrics.requestTimes.shift();
                }
                // Update average response time
                const sum = this.concurrentMetrics.requestTimes.reduce((a, b) => a + b, 0);
                this.concurrentMetrics.averageResponseTime = Math.round(sum / this.concurrentMetrics.requestTimes.length);
            }
        } else if (type === 'error') {
            this.concurrentMetrics.failedRequests++;
            if (errorType && this.concurrentMetrics.errorBreakdown[errorType] !== undefined) {
                this.concurrentMetrics.errorBreakdown[errorType]++;
            }
        }

        this.concurrentMetrics.totalRequests = this.concurrentMetrics.successfulRequests + this.concurrentMetrics.failedRequests;
    },

    // Show error for individual driver
    showIndividualDriverError(driverName, errorMessage) {
        if (!driverName || !errorMessage) {
            console.warn('ErrorHandler.showIndividualDriverError: Missing required parameters');
            return false;
        }

        // Get elements associated with this driver
        let targetElements = [];
        if (typeof RequestDeduplicationManager !== 'undefined') {
            targetElements = RequestDeduplicationManager.getElementsForDriver(driverName);
        }

        if (targetElements.length === 0) {
            console.warn(`ErrorHandler.showIndividualDriverError: No elements found for driver ${driverName}`);
            return false;
        }

        let updatedCount = 0;

        // Show error for each element associated with this driver
        targetElements.forEach(element => {
            if (element) {
                try {
                    // Use LoadingManager if available for consistent error display
                    if (typeof LoadingManager !== 'undefined' && LoadingManager.showErrorForElement) {
                        LoadingManager.showErrorForElement(element, errorMessage);
                    } else {
                        // Direct DOM manipulation as fallback
                        this.showError(element, errorMessage, driverName);
                    }
                    updatedCount++;
                } catch (error) {
                    console.error(`ErrorHandler: Error showing error for driver ${driverName}:`, error);
                }
            }
        });

        console.log(`ErrorHandler: Showed error for driver ${driverName} in ${updatedCount} elements: ${errorMessage}`);
        return updatedCount > 0;
    },

    // Get concurrent request success/failure metrics
    getConcurrentMetrics() {
        const totalDrivers = this.concurrentMetrics.driversWithErrors.size + this.concurrentMetrics.successfulDrivers.size;
        const successRate = totalDrivers > 0 ? (this.concurrentMetrics.successfulDrivers.size / totalDrivers) * 100 : 0;
        const failureRate = totalDrivers > 0 ? (this.concurrentMetrics.driversWithErrors.size / totalDrivers) * 100 : 0;

        return {
            ...this.concurrentMetrics,
            totalDrivers: totalDrivers,
            successRate: Math.round(successRate * 100) / 100,
            failureRate: Math.round(failureRate * 100) / 100,
            driversWithErrorsList: Array.from(this.concurrentMetrics.driversWithErrors),
            successfulDriversList: Array.from(this.concurrentMetrics.successfulDrivers)
        };
    },

    // Log concurrent request metrics summary
    logConcurrentMetricsSummary() {
        const metrics = this.getConcurrentMetrics();

        console.log('=== Concurrent Request Metrics Summary ===');
        console.log(`Total Drivers: ${metrics.totalDrivers}`);
        console.log(`Success Rate: ${metrics.successRate}%`);
        console.log(`Failure Rate: ${metrics.failureRate}%`);
        console.log(`Average Response Time: ${metrics.averageResponseTime}ms`);
        console.log('Error Breakdown:', metrics.errorBreakdown);
        console.log('=== End Metrics Summary ===');
    },

    // Reset concurrent request metrics
    resetConcurrentMetrics() {
        this.driverErrors.clear();
        this.concurrentMetrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            driversWithErrors: new Set(),
            successfulDrivers: new Set(),
            errorBreakdown: {
                network: 0,
                api: 0,
                data: 0,
                timeout: 0
            },
            lastRequestTime: 0,
            averageResponseTime: 0,
            requestTimes: []
        };
        console.log('ErrorHandler: Concurrent request metrics reset');
    },

    // Categorize errors based on error properties
    categorizeError(error) {
        if (!error) {
            return 'generic';
        }

        // Network-related errors
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            return this.ERROR_TYPES.NETWORK;
        }

        // Timeout errors
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
            return this.ERROR_TYPES.TIMEOUT;
        }

        // HTTP errors (API errors)
        if (error.status && (error.status >= 400 && error.status < 600)) {
            return this.ERROR_TYPES.API;
        }

        // Data parsing errors
        if (error instanceof SyntaxError || error.message.includes('JSON')) {
            return this.ERROR_TYPES.DATA;
        }

        // Default to API error for unknown errors
        return this.ERROR_TYPES.API;
    },

    // Get user-friendly error message
    getErrorMessage(errorType) {
        return this.ERROR_MESSAGES[errorType] || this.ERROR_MESSAGES.generic;
    },

    // Log error details to console for debugging (enhanced for individual drivers)
    logError(error, context = {}) {
        const logData = {
            error: {
                name: error?.name || 'Unknown',
                message: error?.message || 'No message',
                stack: error?.stack || 'No stack trace'
            },
            context: {
                ...context,
                errorHandlerType: context.driverName ? 'individual' : 'batch'
            },
            userAgent: navigator.userAgent,
            url: window.location.href
        };

        console.error('iRacing Forum Extension Error:', logData);

        // Also log a simplified version for easier debugging
        const errorContext = context.driverName ? `individual driver "${context.driverName}"` : 'batch operation';
        console.error(`Error ${context.type || 'unknown'} for ${errorContext}:`, error);
    },

    // Show error message in DOM element
    showError(element, message, driverName = null) {
        if (!element) {
            console.warn('ErrorHandler.showError: No element provided');
            return;
        }

        const errorHtml = `<span class="error-message fs90">${message}</span>`;
        element.innerHTML = errorHtml;

        // Log that we're showing an error to user
        console.warn(`Showing error to user for driver "${driverName || 'unknown'}": ${message}`);
    },

    // Cleanup error tracking (for page navigation)
    cleanup() {
        this.driverErrors.clear();
        this.resetConcurrentMetrics();
        console.log('ErrorHandler: Cleaned up all error tracking and metrics');
    }
};

// Loading Manager for visual feedback
const LoadingManager = {
    // Loading state tracking
    loadingStates: new Map(),

    // Create animated spinner element
    createSpinner() {
        return `
            <div class="loading-spinner">
                <div class="spinner-circle"></div>
                <span class="loading-text">Loading stats...</span>
                <div class="loading-progress">
                    <div class="progress-bar"></div>
                </div>
            </div>
        `;
    },

    // Show loading indicator for a specific driver
    showLoading(driverName, element) {
        if (!element || !driverName) {
            console.warn('LoadingManager.showLoading: Missing required parameters');
            return;
        }

        // Create unique ID using element reference
        const loadingId = 'loading_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        element.setAttribute('data-loading-id', loadingId);

        const startTime = Date.now();

        // Store loading state with element-specific ID
        this.loadingStates.set(loadingId, {
            driverName: driverName,
            element: element,
            startTime: startTime,
            estimatedDuration: 20000, // 20 seconds estimated
            progressInterval: null
        });

        // Set loading HTML with spinner
        element.innerHTML = this.createSpinner();

        // Start progress animation
        this.startProgressAnimation(loadingId);

        console.log(`Loading started for driver: ${driverName} (ID: ${loadingId})`);
    },

    // Hide loading indicator and show content for specific element
    hideLoadingForElement(element, content = null) {
        if (!element) {
            console.warn('LoadingManager.hideLoadingForElement: No element provided');
            return;
        }

        const loadingId = element.getAttribute('data-loading-id');
        if (!loadingId) {
            console.warn('LoadingManager.hideLoadingForElement: No loading ID found on element');
            return;
        }

        const loadingState = this.loadingStates.get(loadingId);
        if (!loadingState) {
            console.warn(`LoadingManager.hideLoadingForElement: No loading state found for ID ${loadingId}`);
            return;
        }

        // Clear progress animation
        if (loadingState.progressInterval) {
            clearInterval(loadingState.progressInterval);
        }

        // Calculate actual loading time
        const loadingTime = Date.now() - loadingState.startTime;
        console.log(`Loading completed for driver: ${loadingState.driverName} in ${loadingTime}ms (ID: ${loadingId})`);

        // Add transition effect before showing content
        if (loadingState.element) {
            loadingState.element.classList.add('loading-complete');

            // Small delay for smooth transition
            setTimeout(() => {
                if (content !== null) {
                    loadingState.element.innerHTML = content;
                }
                loadingState.element.classList.remove('loading-complete');
            }, 150);
        }

        // Clean up loading state
        this.loadingStates.delete(loadingId);
    },

    // Show error state for specific element
    showErrorForElement(element, errorMessage) {
        if (!element) {
            console.warn('LoadingManager.showErrorForElement: No element provided');
            return;
        }

        const loadingId = element.getAttribute('data-loading-id');
        if (!loadingId) {
            console.warn('LoadingManager.showErrorForElement: No loading ID found on element');
            return;
        }

        const loadingState = this.loadingStates.get(loadingId);
        if (!loadingState) {
            console.warn(`LoadingManager.showErrorForElement: No loading state found for ID ${loadingId}`);
            return;
        }

        // Clear progress animation
        if (loadingState.progressInterval) {
            clearInterval(loadingState.progressInterval);
        }

        // Show error with fade transition
        if (loadingState.element) {
            loadingState.element.classList.add('loading-error');
            loadingState.element.innerHTML = `<span class="error-message fs90">${errorMessage}</span>`;
        }

        // Clean up loading state
        this.loadingStates.delete(loadingId);

        console.log(`Loading error for driver: ${loadingState.driverName} - ${errorMessage} (ID: ${loadingId})`);
    },

    // Start progress bar animation
    startProgressAnimation(loadingId) {
        const loadingState = this.loadingStates.get(loadingId);
        if (!loadingState) return;

        let progress = 0;
        const increment = 100 / (loadingState.estimatedDuration / 100); // Update every 100ms

        loadingState.progressInterval = setInterval(() => {
            progress += increment;

            // Slow down progress as it approaches 90% to avoid completing before actual load
            if (progress > 90) {
                progress = 90 + (progress - 90) * 0.1;
            }

            const progressBar = loadingState.element?.querySelector('.progress-bar');
            if (progressBar) {
                progressBar.style.width = Math.min(progress, 95) + '%';
            }

            // Update loading text with time estimate
            const elapsed = Date.now() - loadingState.startTime;
            const remaining = Math.max(0, loadingState.estimatedDuration - elapsed);
            const loadingText = loadingState.element?.querySelector('.loading-text');

            if (loadingText && remaining > 0) {
                const seconds = Math.ceil(remaining / 1000);
                loadingText.textContent = `Loading stats... (~${seconds}s)`;
            }

        }, 100);
    },

    // Generate unique loading ID for driver
    generateLoadingId(driverName) {
        return 'loading_' + driverName.toLowerCase().replace(/\s+/g, '_');
    },

    // Check if driver is currently loading
    isLoading(driverName) {
        const loadingId = this.generateLoadingId(driverName);
        return this.loadingStates.has(loadingId);
    },

    // Get loading statistics
    getLoadingStats() {
        return {
            activeLoading: this.loadingStates.size,
            loadingDrivers: Array.from(this.loadingStates.values()).map(state => state.driverName)
        };
    },

    // Clean up all loading states (useful for page cleanup)
    cleanup() {
        this.loadingStates.forEach((state, loadingId) => {
            if (state.progressInterval) {
                clearInterval(state.progressInterval);
            }
        });
        this.loadingStates.clear();
        console.log('LoadingManager: Cleaned up all loading states');
    }
};

// Request Deduplication Manager for handling duplicate driver requests
const RequestDeduplicationManager = {
    // Map to track pending requests by driver name
    pendingRequests: new Map(),

    // Map to track driver-to-elements associations
    driverElementMap: new Map(),

    // Add a driver request to the pending requests map
    addPendingRequest(driverName, requestPromise) {
        if (!driverName || !requestPromise) {
            console.warn('RequestDeduplicationManager.addPendingRequest: Missing required parameters');
            return false;
        }

        // Store the promise for this driver
        this.pendingRequests.set(driverName, requestPromise);

        // Clean up when request completes (success or failure)
        requestPromise.finally(() => {
            this.pendingRequests.delete(driverName);
        });

        console.log(`Added pending request for driver: ${driverName}`);
        return true;
    },

    // Check if a driver request is already pending
    isPending(driverName) {
        return this.pendingRequests.has(driverName);
    },

    // Get existing pending request for a driver
    getPendingRequest(driverName) {
        return this.pendingRequests.get(driverName);
    },

    // Associate a driver name with DOM elements
    associateDriverWithElements(driverName, elements) {
        if (!driverName) {
            console.warn('RequestDeduplicationManager.associateDriverWithElements: Missing driver name');
            return false;
        }

        // Ensure elements is an array
        const elementArray = Array.isArray(elements) ? elements : [elements].filter(Boolean);

        if (elementArray.length === 0) {
            console.warn(`RequestDeduplicationManager.associateDriverWithElements: No valid elements for driver ${driverName}`);
            return false;
        }

        // Get existing elements or create new array
        const existingElements = this.driverElementMap.get(driverName) || [];

        // Add new elements, avoiding duplicates
        elementArray.forEach(element => {
            if (element && !existingElements.includes(element)) {
                existingElements.push(element);
            }
        });

        // Update the map
        this.driverElementMap.set(driverName, existingElements);

        console.log(`Associated driver ${driverName} with ${existingElements.length} elements`);
        return true;
    },

    // Get all DOM elements associated with a driver
    getElementsForDriver(driverName) {
        return this.driverElementMap.get(driverName) || [];
    },

    // Update all DOM elements for a driver when data loads
    updateAllElementsForDriver(driverName, updateCallback) {
        const elements = this.getElementsForDriver(driverName);

        if (elements.length === 0) {
            console.warn(`RequestDeduplicationManager.updateAllElementsForDriver: No elements found for driver ${driverName}`);
            return 0;
        }

        let updatedCount = 0;
        elements.forEach(element => {
            try {
                if (element && typeof updateCallback === 'function') {
                    updateCallback(element, driverName);
                    updatedCount++;
                }
            } catch (error) {
                console.error(`Error updating element for driver ${driverName}:`, error);
            }
        });

        console.log(`Updated ${updatedCount} elements for driver: ${driverName}`);
        return updatedCount;
    },

    // Remove driver from element associations (cleanup)
    removeDriverAssociation(driverName) {
        const removed = this.driverElementMap.delete(driverName);
        if (removed) {
            console.log(`Removed driver association for: ${driverName}`);
        }
        return removed;
    },

    // Get statistics about current state
    getStats() {
        return {
            pendingRequests: this.pendingRequests.size,
            driverAssociations: this.driverElementMap.size,
            pendingDrivers: Array.from(this.pendingRequests.keys()),
            associatedDrivers: Array.from(this.driverElementMap.keys())
        };
    },

    // Clean up all pending requests and associations
    cleanup() {
        this.pendingRequests.clear();
        this.driverElementMap.clear();
        console.log('RequestDeduplicationManager: Cleaned up all pending requests and associations');
    },

    // Check if same driver makes only one API request per page load
    shouldMakeRequest(driverName) {
        // Don't make request if already pending
        if (this.isPending(driverName)) {
            console.log(`Request deduplication: Driver ${driverName} already has pending request`);
            return false;
        }

        // Check cache first
        const cached = CacheManager.get(driverName);
        if (cached) {
            console.log(`Request deduplication: Driver ${driverName} found in cache`);
            return false;
        }

        return true;
    },

    // Get or create a request for a driver (deduplication logic)
    getOrCreateRequest(driverName, requestFactory) {
        // If request is already pending, return the existing promise
        if (this.isPending(driverName)) {
            console.log(`Request deduplication: Returning existing request for driver ${driverName}`);
            return this.getPendingRequest(driverName);
        }

        // Check cache first
        const cached = CacheManager.get(driverName);
        if (cached) {
            console.log(`Request deduplication: Returning cached data for driver ${driverName}`);
            return Promise.resolve({ [driverName]: cached });
        }

        // Create new request
        if (typeof requestFactory !== 'function') {
            console.error('RequestDeduplicationManager.getOrCreateRequest: requestFactory must be a function');
            return Promise.reject(new Error('Invalid request factory'));
        }

        const requestPromise = requestFactory(driverName);
        this.addPendingRequest(driverName, requestPromise);

        console.log(`Request deduplication: Created new request for driver ${driverName}`);
        return requestPromise;
    }
};

// Cache Manager for driver data
const CacheManager = {
    CACHE_TTL: 5 * 60 * 1000, // 5 minutes in milliseconds
    CACHE_PREFIX: 'iracing_driver_',

    // Generate cache key for driver name
    _generateKey(driverName) {
        return this.CACHE_PREFIX + driverName.toLowerCase().replace(/\s+/g, '_');
    },

    // Get cached data for a driver
    get(driverName) {
        try {
            if (!window.sessionStorage) {
                return null;
            }

            const key = this._generateKey(driverName);
            const cached = sessionStorage.getItem(key);

            if (!cached) {
                return null;
            }

            const parsedData = JSON.parse(cached);

            // Check if data has expired
            if (this.isExpired(parsedData.timestamp)) {
                this.remove(driverName);
                return null;
            }

            return parsedData.data;
        } catch (error) {
            console.warn('CacheManager.get error:', error);
            return null;
        }
    },

    // Set cached data for a driver
    set(driverName, data) {
        try {
            if (!window.sessionStorage) {
                return false;
            }

            const key = this._generateKey(driverName);
            const cacheEntry = {
                data: data,
                timestamp: Date.now(),
                version: '1.0'
            };

            sessionStorage.setItem(key, JSON.stringify(cacheEntry));
            return true;
        } catch (error) {
            console.warn('CacheManager.set error:', error);
            // Handle quota exceeded by cleaning up old entries
            if (error.name === 'QuotaExceededError') {
                this.cleanup();
                try {
                    const key = this._generateKey(driverName);
                    const cacheEntry = {
                        data: data,
                        timestamp: Date.now(),
                        version: '1.0'
                    };
                    sessionStorage.setItem(key, JSON.stringify(cacheEntry));
                    return true;
                } catch (retryError) {
                    console.warn('CacheManager.set retry failed:', retryError);
                }
            }
            return false;
        }
    },

    // Remove cached data for a driver
    remove(driverName) {
        try {
            if (!window.sessionStorage) {
                return;
            }

            const key = this._generateKey(driverName);
            sessionStorage.removeItem(key);
        } catch (error) {
            console.warn('CacheManager.remove error:', error);
        }
    },

    // Check if timestamp is expired
    isExpired(timestamp) {
        return (Date.now() - timestamp) > this.CACHE_TTL;
    },

    // Clear all cached driver data
    clear() {
        try {
            if (!window.sessionStorage) {
                return;
            }

            const keysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && key.startsWith(this.CACHE_PREFIX)) {
                    keysToRemove.push(key);
                }
            }

            keysToRemove.forEach(key => sessionStorage.removeItem(key));
        } catch (error) {
            console.warn('CacheManager.clear error:', error);
        }
    },

    // Cleanup expired entries
    cleanup() {
        try {
            if (!window.sessionStorage) {
                return;
            }

            const keysToRemove = [];
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
                    }
                }
            }

            keysToRemove.forEach(key => sessionStorage.removeItem(key));
        } catch (error) {
            console.warn('CacheManager.cleanup error:', error);
        }
    }
};

const svg_add = {
    oval: ' viewBox="-2 -1.55 28 18"><path d="m18 3h-12c-1.6568 0-3 1.3432-3 3v0.7918c0 1.1363 0.64201 2.1751 1.6584 2.6833l2.6459 1.3229c2.956 1.478 6.4354 1.478 9.3914 0l2.6459-1.3229c1.0164-0.5082 1.6584-1.547 1.6584-2.6833v-0.7918c0-1.6568-1.3431-3-3-3zm-12-3h12c3.3137 0 6 2.6863 6 6v0.7918c0 2.2726-1.284 4.3502-3.3167 5.3666l-2.6459 1.3229c-3.8006 1.9003-8.2742 1.9003-12.075 0l-2.6459-1.3229c-2.0327-1.0164-3.3167-3.094-3.3167-5.3666v-0.7918c0-3.3137 2.6863-6 6-6z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd"/></svg>',
    sports_car: ' viewBox="-2 -2 28 18"><path d="m22.5 5.25h-0.8785l-1.5-1.75h0.8785c0.8284 0 1.5-0.78349 1.5-1.75h-3.8785l-0.6213-0.72487c-0.5626-0.65637-1.3256-1.0251-2.1213-1.0251h-7.7574c-0.79565 0-1.5587 0.36875-2.1213 1.0251l-0.62132 0.72487h-3.8789c0 0.9665 0.67157 1.75 1.5 1.75h0.87891l-1.5 1.75h-0.87891c-0.82843 0-1.5 0.78353-1.5 1.75v5.25c0 0.96646 0.67157 1.75 1.5 1.75h1.5c0.82843 0 1.5-0.78353 1.5-1.75h15c0 0.96646 0.6716 1.75 1.5 1.75h1.5c0.8284 0 1.5-0.78353 1.5-1.75v-5.25c0-0.96646-0.6716-1.75-1.5-1.75zm-2.9998 0h-15l2.5604-2.9874c0.2813-0.32819 0.66284-0.51256 1.0607-0.51256h7.7574c0.3978 0 0.7793 0.18438 1.0606 0.51256zm-10.94 2.2625-0.75 0.875c-0.19891 0.23217-0.31066 0.54681-0.31066 0.875 0 0.68343 0.47487 1.2375 1.0607 1.2375h6.8786c0.5858 0 1.0607-0.55405 1.0607-1.2375 0-0.32818-0.1117-0.64283-0.3107-0.875l-0.75-0.875c-0.2813-0.32818-0.6628-0.51251-1.0606-0.51251h-4.7574c-0.39782 0-0.77935 0.18433-1.0607 0.51251zm-3.7678 0.89576c-0.18753 0.21875-0.44189 0.34171-0.7071 0.34171h-1.0858v-1.75h3zm16.207 0.34171h-1.0858c-0.2652 0-0.5196-0.12297-0.7071-0.34171l-1.2071-1.4083h3z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd" stroke-width="1.0801"/></svg>',
    formula_car: ' viewBox="-2 -1 28 18"><path d="m8.9538 4.3636h-1.4538c-0.82843 0-1.5 0.65121-1.5 1.4545v1.9394l-1.5 0.48484v-0.96969c0-0.80329-0.67157-1.4545-1.5-1.4545h-1.5c-0.82843 0-1.5 0.65124-1.5 1.4545v4.3636c0 0.80329 0.67157 1.4545 1.5 1.4545h1.5c0.82843 0 1.5-0.65124 1.5-1.4545v-1.9394l1.5393-0.49755c0.23262 1.3821 1.4696 2.4369 2.9607 2.4369h0.85714l0.21426 1.4545h-5.5714c0 0.80329 0.67157 1.4545 1.5 1.4545h4.2857l0.0022 0.01464c0.1217 0.82618 0.8514 1.4399 1.7121 1.4399s1.5904-0.61372 1.7121-1.4399l0.0022-0.01464h4.2857c0.8284 0 1.5-0.65124 1.5-1.4545h-5.5714l0.2143-1.4545h0.8571c1.4911 0 2.7281-1.0548 2.9607-2.4369l1.5393 0.49755v1.9394c0 0.80329 0.6716 1.4545 1.5 1.4545h1.5c0.8284 0 1.5-0.65124 1.5-1.4545v-4.3636c0-0.80329-0.6716-1.4545-1.5-1.4545h-1.5c-0.8284 0-1.5 0.65124-1.5 1.4545v0.96969l-1.5-0.48484v-1.9394c0-0.80332-0.6716-1.4545-1.5-1.4545h-1.4539l-0.375-1.4545h4.8289c0.8284 0 1.5-0.65121 1.5-1.4545h-6.7039l-0.0199-0.077333c-0.2087-0.80939-0.9586-1.3772-1.819-1.3772h-0.9144c-0.8604 0-1.6104 0.56781-1.819 1.3772l-0.01994 0.077333h-6.7038c0 0.80332 0.67157 1.4545 1.5 1.4545h4.8288zm6.0462 1.4545h1.5v2.9091c0 0.80329-0.6716 1.4545-1.5 1.4545h-0.6429zm-4.5-1.4545h3l-0.679-2.6336c-0.0417-0.16188-0.1917-0.27544-0.3638-0.27544h-0.9144c-0.1721 0-0.3221 0.11356-0.3638 0.27544zm-1.5 1.4545h-1.5v2.9091c0 0.80329 0.67157 1.4545 1.5 1.4545h0.64286z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd" stroke-width=".98473"/></svg>',
    dirt_oval: ' viewBox="-2 0 28 18"><path d="m8 0h8c3.7712 0 5.6569 0 6.8284 1.1716 1.1716 1.1716 1.1716 3.0572 1.1716 6.8284v2c0 3.7712 0 5.6569-1.1716 6.8284-1.1715 1.1716-3.0572 1.1716-6.8284 1.1716h-8c-3.7712 0-5.6568 0-6.8284-1.1716-1.1716-1.1715-1.1716-3.0572-1.1716-6.8284v-2c0-3.7712 0-5.6568 1.1716-6.8284s3.0572-1.1716 6.8284-1.1716zm1 6h6c1.6569 0 3 1.3431 3 3s-1.3431 3-3 3h-6c-1.6568 0-3-1.3431-3-3s1.3432-3 3-3zm6-3h-6c-3.3137 0-6 2.6863-6 6s2.6863 6 6 6h6c3.3137 0 6-2.6863 6-6s-2.6863-6-6-6z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd"/></svg>',
    dirt_road: ' viewBox="-2 0 28 18"><path d="m8 0h8c3.7712 0 5.6569 0 6.8284 1.1716 1.1716 1.1716 1.1716 3.0572 1.1716 6.8284v2c0 3.7712 0 5.6569-1.1716 6.8284-1.1715 1.1716-3.0572 1.1716-6.8284 1.1716h-8c-3.7712 0-5.6568 0-6.8284-1.1716-1.1716-1.1715-1.1716-3.0572-1.1716-6.8284v-2c0-3.7712 0-5.6568 1.1716-6.8284s3.0572-1.1716 6.8284-1.1716zm-2 15h-3v-9c0-1.6568 1.3432-3 3-3h4.5c1.6569 0 3 1.3432 3 3v4c0 1.1046 0.8954 2 2 2h0.5c1.1046 0 2-0.8954 2-2v-7h3v9c0 1.6569-1.3431 3-3 3h-4.5c-1.6569 0-3-1.3431-3-3v-4c0-1.1046-0.89543-2-2-2h-0.5c-1.1046 0-2 0.89543-2 2z" clip-rule="evenodd" fill="currentColor" fill-rule="evenodd"/></svg>',
    undefined: ' viewBox="0 0 1 18"></svg>',
}
const cars_json = [{"car_id":1,"car_name_abbreviated":"SBRS","car_name":"Skip Barber Formula 2000","categories":["formula_car"]},{"car_id":2,"car_make":"Modified","car_model":"SK","car_name_abbreviated":"SK","car_name":"Modified - SK","categories":["oval"]},{"car_id":3,"car_make":"Pontiac","car_model":"Solstice","car_name_abbreviated":"SOL","car_name":"Pontiac Solstice","categories":["sports_car"]},{"car_id":4,"car_name_abbreviated":"PM","car_name":"[Legacy] Pro Mazda","categories":["formula_car"]},{"car_id":5,"car_make":"Legends","car_model":"Advanced","car_name_abbreviated":"LEG","car_name":"Legends Ford '34 Coupe","categories":["oval"]},{"car_id":10,"car_make":"Pontiac","car_model":"Solstice","car_name_abbreviated":"SOL-R","car_name":"Pontiac Solstice - Rookie","categories":["sports_car"]},{"car_id":11,"car_make":"Legends","car_model":"Rookie","car_name_abbreviated":"LEG-R","car_name":"Legends Ford '34 Coupe - Rookie","categories":["oval"]},{"car_id":12,"car_make":"Chevrolet","car_name_abbreviated":"LM","car_name":"[Retired] - Chevrolet Monte Carlo SS","categories":["oval"]},{"car_id":13,"car_make":"Radical ","car_model":" ","car_name_abbreviated":"SR8","car_name":"Radical SR8","categories":["sports_car"]},{"car_id":18,"car_name_abbreviated":"SC","car_name":"Silver Crown","categories":["oval"]},{"car_id":20,"car_make":"Chevrolet","car_model":"Silverado","car_name_abbreviated":"TRUCK","car_name":"[Legacy] NASCAR Truck Chevrolet Silverado - 2008","categories":["oval"]},{"car_id":21,"car_make":"Riley","car_model":"MkXX DP","car_name_abbreviated":"DP","car_name":"[Legacy] Riley MkXX Daytona Prototype - 2008","categories":["sports_car"]},{"car_id":22,"car_make":"Chevrolet","car_model":"Impala","car_name_abbreviated":"CUP","car_name":"[Legacy] NASCAR Cup Chevrolet Impala COT - 2009","categories":["oval"]},{"car_id":23,"car_make":"SCCA Enterprises","car_name_abbreviated":"SRF","car_name":"SCCA Spec Racer Ford","categories":["sports_car"]},{"car_id":24,"car_make":"Chevrolet","car_model":"Impala SS","car_name_abbreviated":"NW09","car_name":"ARCA Menards Chevrolet Impala","categories":["oval"]},{"car_id":25,"car_make":"Lotus","car_model":"Lotus 79","car_name_abbreviated":"L79","car_name":"Lotus 79","categories":["formula_car"]},{"car_id":26,"car_make":"Chevrolet","car_model":"C6R","car_name_abbreviated":"C6R GT1","car_name":"Chevrolet Corvette C6.R GT1","categories":["sports_car"]},{"car_id":27,"car_make":"Volkswagen","car_model":"Jetta TDI","car_name_abbreviated":"VWTDI","car_name":"VW Jetta TDI Cup","categories":["sports_car"]},{"car_id":28,"car_make":"Ford","car_model":"Falcon FG01 V8","car_name_abbreviated":"V8SC","car_name":"[Legacy] V8 Supercar Ford Falcon - 2009","categories":["sports_car"]},{"car_id":29,"car_make":"Dallara","car_model":"IR-05","car_name_abbreviated":"INDY","car_name":"[Legacy] Dallara IR-05","categories":["formula_car"]},{"car_id":30,"car_make":"Ford","car_model":"FR500S","car_name_abbreviated":"FR500","car_name":"Ford Mustang FR500S","categories":["sports_car"]},{"car_id":31,"car_make":"Modified","car_model":"Tour","car_name_abbreviated":"TMOD","car_name":"Modified - NASCAR Whelen Tour","categories":["oval"]},{"car_id":33,"car_make":"Williams","car_model":"FW31","car_name_abbreviated":"FW31","car_name":"Williams-Toyota FW31","categories":["formula_car"]},{"car_id":34,"car_make":"Mazda","car_model":"MX-5 Cup","car_name_abbreviated":"MX5-C","car_name":"[Legacy] Mazda MX-5 Cup - 2010","categories":["sports_car"]},{"car_id":35,"car_make":"Mazda","car_model":"MX-5 Roadster","car_name_abbreviated":"MX5-R","car_name":"[Legacy] Mazda MX-5 Roadster - 2010","categories":["sports_car"]},{"car_id":36,"car_name_abbreviated":"SS","car_name":"Street Stock","categories":["oval"]},{"car_id":37,"car_name_abbreviated":"SPRT","car_name":"Sprint Car","categories":["oval"]},{"car_id":38,"car_make":"Chevrolet","car_name_abbreviated":"IMPB","car_name":"[Legacy] NASCAR Nationwide Chevrolet Impala - 2012","categories":["oval"]},{"car_id":39,"car_make":"HPD","car_model":"ARX-01C","car_name_abbreviated":"ARX","car_name":"HPD ARX-01c","categories":["sports_car"]},{"car_id":40,"car_make":"Ford","car_model":"GT2","car_name_abbreviated":"FGT","car_name":"Ford GT GT2","categories":["sports_car"]},{"car_id":41,"car_make":"Cadillac","car_model":"CTS-VR","car_name_abbreviated":"CTSVR","car_name":"Cadillac CTS-V Racecar","categories":["sports_car"]},{"car_id":42,"car_make":"Lotus","car_model":"Lotus 49","car_name_abbreviated":"L49","car_name":"Lotus 49","categories":["formula_car"]},{"car_id":43,"car_make":"McLaren","car_model":"MP4-12C","car_name_abbreviated":"MP4","car_name":"McLaren MP4-12C GT3","categories":["sports_car"]},{"car_id":44,"car_make":"Kia","car_model":"Optima","car_name_abbreviated":"KIAOPT","car_name":"Kia Optima","categories":["sports_car"]},{"car_id":45,"car_make":"Chevrolet","car_model":"SS","car_name_abbreviated":"CSS","car_name":"[Legacy] NASCAR Cup Chevrolet SS - 2013","categories":["oval"]},{"car_id":46,"car_make":"Ford","car_model":"Fusion-Gen6","car_name_abbreviated":"FF","car_name":"[Legacy] NASCAR Cup Ford Fusion - 2016","categories":["oval"]},{"car_id":48,"car_make":"Ruf","car_model":"AWD","car_name_abbreviated":"R12A","car_name":"Ruf RT 12R AWD","categories":["sports_car"]},{"car_id":49,"car_make":"Ruf","car_model":"RWD","car_name_abbreviated":"R12R","car_name":"Ruf RT 12R RWD","categories":["sports_car"]},{"car_id":50,"car_make":"Ruf","car_model":"Track","car_name_abbreviated":"R12T","car_name":"Ruf RT 12R Track","categories":["sports_car"]},{"car_id":51,"car_make":"Ford","car_model":"Mustang","car_name_abbreviated":"FM","car_name":"[Legacy] NASCAR Xfinity Ford Mustang - 2016","categories":["oval"]},{"car_id":52,"car_make":"Ruf","car_model":"C-Spec","car_name_abbreviated":"R12C","car_name":"Ruf RT 12R C-Spec","categories":["sports_car"]},{"car_id":54,"car_model":"Super Late Model","car_name_abbreviated":"SLM","car_name":"Super Late Model","categories":["oval"]},{"car_id":55,"car_make":"BMW","car_model":"Z4 GT3","car_name_abbreviated":"BMWZ","car_name":"[Legacy] BMW Z4 GT3","categories":["sports_car"]},{"car_id":56,"car_make":"Toyota","car_model":"Camry-Gen6","car_name_abbreviated":"TC","car_name":"NASCAR Cup Series Toyota Camry","categories":["oval"]},{"car_id":57,"car_make":"Dallara","car_model":"DW12","car_name_abbreviated":"DW12","car_name":"[Legacy] Dallara DW12","categories":["formula_car"]},{"car_id":58,"car_make":"Chevrolet","car_model":"Camaro","car_name_abbreviated":"CCB","car_name":"[Legacy] NASCAR Xfinity Chevrolet Camaro - 2014","categories":["oval"]},{"car_id":59,"car_make":"Ford","car_model":"GT3","car_name_abbreviated":"FGT3","car_name":"Ford GT GT3","categories":["sports_car"]},{"car_id":60,"car_make":"Holden","car_model":"Commodore VF","car_name_abbreviated":"HCV8","car_name":"[Legacy] V8 Supercar Holden VF Commodore - 2014","categories":["sports_car"]},{"car_id":61,"car_make":"Ford","car_model":"Falcon FG","car_name_abbreviated":"FFV8","car_name":"[Legacy] V8 Supercar Ford FG Falcon - 2014","categories":["sports_car"]},{"car_id":62,"car_make":"Toyota","car_model":"Tundra","car_name_abbreviated":"TT","car_name":"[Retired] NASCAR Gander Outdoors Toyota Tundra","categories":["oval"]},{"car_id":63,"car_make":"Chevrolet","car_model":"Silverado","car_name_abbreviated":"CS","car_name":"[Retired] NASCAR Trucks Series Chevrolet Silverado - 2018","categories":["oval"]},{"car_id":64,"car_make":"Aston Martin","car_model":"GT1","car_name_abbreviated":"AM1","car_name":"Aston Martin DBR9 GT1","categories":["sports_car"]},{"car_id":67,"car_make":"Mazda","car_model":"MX-5","car_name_abbreviated":"MX16","car_name":"Global Mazda MX-5 Cup","categories":["sports_car"]},{"car_id":69,"car_make":"Toyota","car_model":"Camry","car_name_abbreviated":"NXTC","car_name":"[Legacy] NASCAR Xfinity Toyota Camry - 2015","categories":["oval"]},{"car_id":70,"car_make":"Chevrolet","car_model":"C7 DP","car_name_abbreviated":"C7DP","car_name":"Chevrolet Corvette C7 Daytona Prototype","categories":["sports_car"]},{"car_id":71,"car_make":"McLaren","car_model":"MP4-30","car_name_abbreviated":"MP430","car_name":"McLaren MP4-30","categories":["formula_car"]},{"car_id":72,"car_make":"Mercedes","car_model":"GT3","car_name_abbreviated":"MGT3","car_name":"[Legacy] Mercedes-AMG GT3","categories":["sports_car"]},{"car_id":73,"car_make":"Audi","car_model":"R8 GT3","car_name_abbreviated":"AR8","car_name":"[Legacy] Audi R8 LMS GT3","categories":["sports_car"]},{"car_id":74,"car_make":"Renault","car_model":"Formula 2.0","car_name_abbreviated":"F20","car_name":"Formula Renault 2.0","categories":["formula_car"]},{"car_id":76,"car_make":"Audi","car_model":"90 GTO","car_name_abbreviated":"A90","car_name":"Audi 90 GTO","categories":["sports_car"]},{"car_id":77,"car_make":"Nissan","car_model":"GTP ZX-T","car_name_abbreviated":"ZXT","car_name":"Nissan GTP ZX-T","categories":["sports_car"]},{"car_id":78,"car_make":"Dirt Late Model","car_model":"350","car_name_abbreviated":"DLM350","car_name":"Dirt Late Model - Limited","categories":["dirt_oval"]},{"car_id":79,"car_name_abbreviated":"SSD","car_name":"Dirt Street Stock","categories":["dirt_oval"]},{"car_id":80,"car_make":"Dirt Sprint Car","car_model":"305","car_name_abbreviated":"DSC305","car_name":"Dirt Sprint Car - 305","categories":["dirt_oval"]},{"car_id":81,"car_make":"Ford","car_model":"Fiesta","car_name_abbreviated":"FF-WSC","car_name":"Ford Fiesta RS WRC","categories":["dirt_road"]},{"car_id":82,"car_make":"Legends","car_model":"Dirt","car_name_abbreviated":"LEG-D","car_name":"Dirt Legends Ford '34 Coupe","categories":["dirt_oval"]},{"car_id":83,"car_make":"Dirt Late Model","car_model":"358","car_name_abbreviated":"DLM358","car_name":"Dirt Late Model - Pro","categories":["dirt_oval"]},{"car_id":84,"car_make":"Dirt Late Model","car_model":"438","car_name_abbreviated":"DLM438","car_name":"Dirt Late Model - Super","categories":["dirt_oval"]},{"car_id":85,"car_make":"Dirt Sprint Car","car_model":"360","car_name_abbreviated":"DSC360","car_name":"Dirt Sprint Car - 360","categories":["dirt_oval"]},{"car_id":86,"car_make":"Dirt Sprint Car","car_model":"410","car_name_abbreviated":"DSC410","car_name":"Dirt Sprint Car - 410","categories":["dirt_oval"]},{"car_id":87,"car_make":"Dirt Sprint Car","car_model":"360 Non-Winged","car_name_abbreviated":"DS360NW","car_name":"Dirt Sprint Car - 360 Non-Winged","categories":["dirt_oval"]},{"car_id":88,"car_make":"Porsche","car_model":"911 GT3 Cup","car_name_abbreviated":"P911","car_name":"[Legacy] Porsche 911 GT3 Cup (991)","categories":["sports_car"]},{"car_id":89,"car_make":"Dirt Sprint Car","car_model":"410 Non-Winged","car_name_abbreviated":"DS410NW","car_name":"Dirt Sprint Car - 410 Non-Winged","categories":["dirt_oval"]},{"car_id":91,"car_make":"Volkswagen","car_model":"Beetle","car_name_abbreviated":"VWB","car_name":"VW Beetle","categories":["dirt_road"]},{"car_id":92,"car_make":"Ford","car_model":"GT","car_name_abbreviated":"FGT7","car_name":"Ford GTE","categories":["sports_car"]},{"car_id":93,"car_make":"Ferrari","car_model":"488 GTE","car_name_abbreviated":"488E","car_name":"Ferrari 488 GTE","categories":["sports_car"]},{"car_id":94,"car_make":"Ferrari","car_model":"488 GT3","car_name_abbreviated":"488T3","car_name":"[Legacy] Ferrari 488 GT3","categories":["sports_car"]},{"car_id":95,"car_make":"Dirt UMP Modified","car_model":"UMP Modified","car_name_abbreviated":"UMP","car_name":"Dirt UMP Modified","categories":["dirt_oval"]},{"car_id":96,"car_make":"Dirt Midget","car_model":"Dirt Midget","car_name_abbreviated":"DM","car_name":"Dirt Midget","categories":["dirt_oval"]},{"car_id":98,"car_make":"Audi","car_model":"R18","car_name_abbreviated":"AR18","car_name":"Audi R18","categories":["sports_car"]},{"car_id":99,"car_make":"Dallara","car_model":"IR18","car_name_abbreviated":"IR18","car_name":"Dallara IR18","categories":["formula_car"]},{"car_id":100,"car_make":"Porsche","car_model":"919","car_name_abbreviated":"919","car_name":"Porsche 919","categories":["sports_car"]},{"car_id":101,"car_make":"Subaru","car_model":"WRX STI","car_name_abbreviated":"WRX","car_name":"Subaru WRX STI","categories":["dirt_road"]},{"car_id":102,"car_make":"Porsche","car_model":"911 RSR","car_name_abbreviated":"RSR","car_name":"Porsche 911 RSR","categories":["sports_car"]},{"car_id":103,"car_make":"Chevrolet","car_model":"Camaro ZL1","car_name_abbreviated":"ZL1","car_name":"NASCAR Cup Series Chevrolet Camaro ZL1","categories":["oval"]},{"car_id":104,"car_model":"Pro 2","car_name_abbreviated":"PRO2","car_name":"Lucas Oil Off Road Pro 2 Truck","categories":["dirt_road"]},{"car_id":105,"car_make":"Renault","car_model":"Formula 3.5","car_name_abbreviated":"F35","car_name":"Formula Renault 3.5","categories":["formula_car"]},{"car_id":106,"car_make":"Dallara","car_model":"F317","car_name_abbreviated":"F317","car_name":"Dallara F3","categories":["formula_car"]},{"car_id":107,"car_model":"Pro 4","car_name_abbreviated":"PRO4","car_name":"Lucas Oil Off Road Pro 4 Truck","categories":["dirt_road"]},{"car_id":109,"car_make":"BMW","car_model":"M8 GTE","car_name_abbreviated":"BMWM8","car_name":"BMW M8 GTE","categories":["sports_car"]},{"car_id":110,"car_make":"Ford","car_model":"Mustang","car_name_abbreviated":"FM2019","car_name":"NASCAR Cup Series Ford Mustang","categories":["oval"]},{"car_id":111,"car_make":"Chevrolet","car_model":"Silverado","car_name_abbreviated":"CS2019","car_name":"NASCAR Truck Chevrolet Silverado","categories":["oval"]},{"car_id":112,"car_make":"Audi","car_model":"RS 3 LMS","car_name_abbreviated":"RS3","car_name":"Audi RS 3 LMS TCR","categories":["sports_car"]},{"car_id":113,"car_model":"Pro 2 Lite","car_name_abbreviated":"PRO2L","car_name":"Lucas Oil Off Road Pro 2 Lite","categories":["dirt_road"]},{"car_id":114,"car_make":"Chevrolet","car_model":"Camaro","car_name_abbreviated":"XCC","car_name":"NASCAR XFINITY Chevrolet Camaro","categories":["oval"]},{"car_id":115,"car_make":"Ford","car_model":"Mustang","car_name_abbreviated":"XFM","car_name":"NASCAR XFINITY Ford Mustang","categories":["oval"]},{"car_id":116,"car_make":"Toyota","car_model":"Supra","car_name_abbreviated":"XTS","car_name":"NASCAR XFINITY Toyota Supra","categories":["oval"]},{"car_id":117,"car_make":"Holden","car_model":"ZB Commodore","car_name_abbreviated":"HZBC","car_name":"Supercars Holden ZB Commodore","categories":["sports_car"]},{"car_id":118,"car_make":"Ford","car_model":"Mustang GT","car_name_abbreviated":"FMGT","car_name":"Supercars Ford Mustang GT","categories":["sports_car"]},{"car_id":119,"car_make":"Porsche","car_model":"718 Cayman GT4 Clubsport MR","car_name_abbreviated":"P718","car_name":"Porsche 718 Cayman GT4 Clubsport MR","categories":["sports_car"]},{"car_id":120,"car_make":"Indy Pro 2000","car_model":"PM-18","car_name_abbreviated":"PM18","car_name":"Indy Pro 2000 PM-18","categories":["formula_car"]},{"car_id":121,"car_make":"USF 2000","car_model":"PM-17","car_name_abbreviated":"PM17","car_name":"USF 2000","categories":["formula_car"]},{"car_id":122,"car_make":"BMW","car_model":"M4 GT4","car_name_abbreviated":"BMWM4","car_name":"BMW M4 GT4","categories":["sports_car"]},{"car_id":123,"car_make":"Ford","car_model":"F150","car_name_abbreviated":"F150","car_name":"NASCAR Truck Ford F150","categories":["oval"]},{"car_id":124,"car_make":"Chevrolet","car_model":"Monte Carlo","car_name_abbreviated":"C87","car_name":"NASCAR Legends Chevrolet Monte Carlo - 1987","categories":["oval"]},{"car_id":125,"car_make":"Ford","car_model":"Thunderbird","car_name_abbreviated":"F87","car_name":"NASCAR Legends Ford Thunderbird - 1987","categories":["oval"]},{"car_id":127,"car_make":"Chevrolet","car_model":"C8.R","car_name_abbreviated":"C8R","car_name":"Chevrolet Corvette C8.R GTE","categories":["sports_car"]},{"car_id":128,"car_make":"Dallara","car_model":"P217","car_name_abbreviated":"P217","car_name":"Dallara P217","categories":["sports_car"]},{"car_id":129,"car_make":"Dallara","car_model":"iR-01","car_name_abbreviated":"IR01","car_name":"Dallara iR-01","categories":["formula_car"]},{"car_id":131,"car_make":"Dirt Modified","car_model":"Big Block Modified","car_name_abbreviated":"BBM","car_name":"Dirt Big Block Modified","categories":["dirt_oval"]},{"car_id":132,"car_make":"BMW","car_model":"M4 GT3","car_name_abbreviated":"M4GT3","car_name":"BMW M4 GT3","categories":["sports_car"]},{"car_id":133,"car_make":"Lamborghini","car_model":"HuracÃ¡n GT3 EVO","car_name_abbreviated":"LGT3","car_name":"Lamborghini HuracÃ¡n GT3 EVO","categories":["sports_car"]},{"car_id":134,"car_make":"Dirt Modified","car_model":"358 Modified","car_name_abbreviated":"358MOD","car_name":"Dirt 358 Modified","categories":["dirt_oval"]},{"car_id":135,"car_make":"McLaren","car_model":"570S GT4","car_name_abbreviated":"M570S","car_name":"McLaren 570S GT4","categories":["sports_car"]},{"car_id":137,"car_make":"Porsche","car_model":"911 GT3 R","car_name_abbreviated":"PGTR","car_name":"[Legacy] Porsche 911 GT3 R","categories":["sports_car"]},{"car_id":138,"car_make":"Volkswagen","car_model":"Beetle - Lite","car_name_abbreviated":"VWBL","car_name":"VW Beetle - Lite","categories":["dirt_road"]},{"car_id":139,"car_make":"Chevrolet","car_model":"Camaro ZL1","car_name_abbreviated":"NGC","car_name":"NASCAR Cup Series Next Gen Chevrolet Camaro ZL1","categories":["oval"]},{"car_id":140,"car_make":"Ford","car_model":"Mustang","car_name_abbreviated":"NGF","car_name":"NASCAR Cup Series Next Gen Ford Mustang","categories":["oval"]},{"car_id":141,"car_make":"Toyota","car_model":"Camry","car_name_abbreviated":"NGT","car_name":"NASCAR Cup Series Next Gen Toyota Camry","categories":["oval"]},{"car_id":142,"car_make":"Formula Vee","car_model":"Formula Vee","car_name_abbreviated":"FVEE","car_name":"Formula Vee","categories":["formula_car"]},{"car_id":143,"car_make":"Porsche","car_model":"992","car_name_abbreviated":"P992","car_name":"Porsche 911 GT3 Cup (992)","categories":["sports_car"]},{"car_id":144,"car_make":"Ferrari","car_model":"Evo GT3","car_name_abbreviated":"FEVO","car_name":"Ferrari 488 GT3 Evo 2020","categories":["sports_car"]},{"car_id":145,"car_make":"Mercedes","car_model":"W12","car_name_abbreviated":"MW12","car_name":"Mercedes-AMG W12 E Performance","categories":["formula_car"]},{"car_id":146,"car_make":"Hyundai","car_model":"Elantra CN7","car_name_abbreviated":"HECN7","car_name":"Hyundai Elantra N TCR","categories":["sports_car"]},{"car_id":147,"car_make":"Honda","car_model":"Civic Type R","car_name_abbreviated":"HCTR","car_name":"Honda Civic Type R TCR","categories":["sports_car"]},{"car_id":148,"car_make":"FIA","car_model":"F4","car_name_abbreviated":"F4","car_name":"FIA F4","categories":["formula_car"]},{"car_id":149,"car_make":"Radical","car_model":"SR10","car_name_abbreviated":"SR10","car_name":"Radical SR10","categories":["sports_car"]},{"car_id":150,"car_make":"Aston Martin","car_model":"Vantage GT4","car_name_abbreviated":"AMV4","car_name":"Aston Martin Vantage GT4","categories":["sports_car"]},{"car_id":151,"car_make":"Cruze","car_model":"Chevrolet","car_name_abbreviated":"SCCC","car_name":"Stock Car Brasil Chevrolet Cruze","categories":["sports_car"]},{"car_id":152,"car_make":"Toyota","car_model":"Corolla","car_name_abbreviated":"SCTC","car_name":"Stock Car Brasil Toyota Corolla","categories":["sports_car"]},{"car_id":153,"car_make":"Hyundai","car_model":"Veloster N","car_name_abbreviated":"HVTC","car_name":"Hyundai Veloster N TCR","categories":["sports_car"]},{"car_id":154,"car_make":"Buick","car_model":"LeSabre","car_name_abbreviated":"B87","car_name":"NASCAR Legends Buick LeSabre - 1987","categories":["oval"]},{"car_id":155,"car_make":"Toyota","car_model":"Tundra TRD Pro","car_name_abbreviated":"TTP","car_name":"NASCAR Truck Toyota Tundra TRD Pro","categories":["oval"]},{"car_id":156,"car_make":"Mercedes-AMG","car_model":"GT3 Evo","car_name_abbreviated":"MGT3E","car_name":"Mercedes-AMG GT3 2020","categories":["sports_car"]},{"car_id":157,"car_make":"Mercedes-AMG","car_model":"GT4","car_name_abbreviated":"MGT4","car_name":"Mercedes-AMG GT4","categories":["sports_car"]},{"car_id":158,"car_make":"Porsche","car_model":"Porsche Mission R","car_name_abbreviated":"PMR","car_name":"Porsche Mission R","categories":["sports_car"]},{"car_id":159,"car_make":"BMW","car_model":"BMWGTP","car_name_abbreviated":"BMWGTP","car_name":"BMW M Hybrid V8","categories":["sports_car"]},{"car_id":160,"car_make":"Toyota","car_model":"GR86","car_name_abbreviated":"GR86","car_name":"Toyota GR86","categories":["sports_car"]},{"car_id":161,"car_make":"Mercedes","car_model":"W13","car_name_abbreviated":"MW13","car_name":"Mercedes-AMG W13 E Performance","categories":["formula_car"]},{"car_id":162,"car_make":"Renault","car_model":"Clio","car_name_abbreviated":"RENC","car_name":"Renault Clio","categories":["sports_car"]},{"car_id":163,"car_make":"Ray","car_model":"Ray GR22","car_name_abbreviated":"GR22","car_name":"Ray FF1600","categories":["formula_car"]},{"car_id":164,"car_model":"Late Model Stock","car_name_abbreviated":"LM23","car_name":"Late Model Stock","categories":["oval"]},{"car_id":165,"car_make":"Ligier","car_model":"JSP 320","car_name_abbreviated":"LJSP","car_name":"Ligier JS P320","categories":["sports_car"]},{"car_id":167,"car_make":"Chevrolet","car_model":"Gen 4 Cup","car_name_abbreviated":"G4CUP","car_name":"Gen 4 Cup","categories":["oval"]},{"car_id":168,"car_make":"Cadillac","car_model":"V-Series.R GTP","car_name_abbreviated":"CGTP","car_name":"Cadillac V-Series.R GTP","categories":["sports_car"]},{"car_id":169,"car_make":"Porsche","car_model":"992 GT3 R","car_name_abbreviated":"992R","car_name":"Porsche 911 GT3 R (992)","categories":["sports_car"]},{"car_id":170,"car_make":"Acura","car_model":"ARX-06 GTP","car_name_abbreviated":"AGTP","car_name":"Acura ARX-06 GTP","categories":["sports_car"]},{"car_id":171,"car_make":"Dallara","car_model":"Super Formula SF23 - Toyota","car_name_abbreviated":"SF23T","car_name":"Super Formula SF23 - Toyota","categories":["formula_car"]},{"car_id":172,"car_make":"Dallara","car_model":"Super Formula SF23 - Honda","car_name_abbreviated":"SF23H","car_name":"Super Formula SF23 - Honda","categories":["formula_car"]},{"car_id":173,"car_make":"Ferrari","car_model":"Ferrari 296 GT3","car_name_abbreviated":"F296","car_name":"Ferrari 296 GT3","categories":["sports_car"]},{"car_id":174,"car_make":"Porsche","car_model":"Porsche 963 GTP","car_name_abbreviated":"PGTP","car_name":"Porsche 963 GTP","categories":["sports_car"]},{"car_id":175,"car_make":"Pontiac","car_model":"NASCAR Legends Pontiac Grand Prix - 1987","car_name_abbreviated":"P87","car_name":"NASCAR Legends Pontiac Grand Prix - 1987","categories":["oval"]},{"car_id":176,"car_make":"Audi","car_model":"Audi R8 LMS EVO II GT3","car_name_abbreviated":"AEVO2","car_name":"Audi R8 LMS EVO II GT3","categories":["sports_car"]},{"car_id":178,"car_make":"Dallara","car_model":"324","car_name_abbreviated":"SFL324","car_name":"Super Formula Lights","categories":["formula_car"]},{"car_id":179,"car_make":"SRX","car_model":"SRX","car_name_abbreviated":"SRX","car_name":"SRX","categories":["oval"]},{"car_id":180,"car_model":"Winged","car_name_abbreviated":"MSCW","car_name":"Dirt Micro Sprint Car - Winged","categories":["dirt_oval"]},{"car_id":181,"car_model":"Non-Winged","car_name_abbreviated":"MSCNW","car_name":"Dirt Micro Sprint Car - Non-Winged","categories":["dirt_oval"]},{"car_id":182,"car_model":"Winged","car_name_abbreviated":"MSCOW","car_name":"Dirt Outlaw Micro Sprint Car - Winged","categories":["dirt_oval"]},{"car_id":183,"car_model":"Non-Winged","car_name_abbreviated":"MSCONW","car_name":"Dirt Outlaw Micro Sprint Car - Non-Winged","categories":["dirt_oval"]}];
let window_portrait = false;
if ((document.documentElement.clientWidth, window.innerWidth || 0) * 1.3 < (document.documentElement.clientHeight, window.innerHeight || 0)) {
    window_portrait = true;
};

'use strict';
(() => {
    let usernames = document.getElementsByClassName('Username')
    let authors = document.getElementsByClassName('Author')
    let author_wrap = document.getElementsByClassName('AuthorWrap')
    let cars_dict = cars_json2dict(cars_json);
    let names = []
    for (const name of usernames){
        names.push(name.firstChild.data);
    }
    for (const author of authors){
        let current_driver = author.getElementsByTagName('a')[0].innerText.replace('Loading\n\n', '');
        const loadingElement = document.createElement('div');
        loadingElement.className = 'loadingstats fwb';
        author.appendChild(loadingElement);

        // Associate this driver with its DOM element for deduplication
        RequestDeduplicationManager.associateDriverWithElements(current_driver, loadingElement);

        // Use LoadingManager for enhanced loading state
        LoadingManager.showLoading(current_driver, loadingElement);
    }
    function years_diff(date) {
        let yearsDifMs = Date.now() - date;
        let yearsDate = new Date(yearsDifMs); // miliseconds from epoch
        return Math.abs(yearsDate.getUTCFullYear() - 1970);
    }
    function cars_json2dict(cars_json) {
        let dict = {};
        for (const car of cars_json) {
            dict[car.car_id] = {
                make: car.car_make || '',
                model: car.car_model || '',
                abbr: car.car_name_abbreviated,
                cat: car.categories[0]
            };
        };
        return dict;
    }
    function ArrayAddUniqueString(array, String) {
        if (!array.includes(String)) {
            array.push(String);
        }
    }
    names = [...new Set(names)];
    function driver_licenses(driver){
        let license = '';
        let licenses = [];
        // console.log(driver.member_info.licenses);
        for (let i = 0; i < driver.member_info.licenses.length; i++){
            let license_class = driver.member_info.licenses[i].group_name.replace('Class ', '')
            license_class = license_class.replace('Rookie', 'R');
            license_class = license_class.replace('Pro', 'P');
            let lic_sort = 0;
            switch (sort_licenses) {
                case 1: lic_sort = Number(sort_lic_default[driver.member_info.licenses[i].category]); break;
                case 2: lic_sort = Number(driver.member_info.licenses[i].irating); break;
                case 3: lic_sort = Number(driver.member_info.licenses[i].cpi); break;
                case 4: lic_sort = 20 * Math.round(driver.member_info.licenses[i].cpi) + Number(driver.member_info.licenses[i].irating); break;
            }

            licenses.push({ 'lic_sort': lic_sort,
                            'category': driver.member_info.licenses[i].category,
                            'category_name': driver.member_info.licenses[i].category_name,
                            'class': license_class,
                            'sr': driver.member_info.licenses[i].safety_rating,
                            'ir': driver.member_info.licenses[i].irating,
                            'cpi': Math.round(driver.member_info.licenses[i].cpi)});
            if (sort_licenses > 0) { licenses.sort((a,b) => b.lic_sort - a.lic_sort); }
        }
        let member_licenses=[]
        licenses.forEach((license, index) => {
            // let license_icon = '<svg viewBox="0 0 24 24" class="ir-cat-svg"><path fill-rule="evenodd" clip-rule="evenodd" d="'+ svg_d[license.category] +'" fill="currentColor"></path></svg>';
            let license_html = '<div class="license-link license-color-'+ license.class +'"> <svg class="ir-cat-svg"'+ svg_add[license.category];
            license_html += license.class + license.sr +' '+ license.ir;
            if (show_cpi) { license_html += '/'+ license.cpi; }
            license_html += '</div>'
            member_licenses.push(license_html)
        })
        return member_licenses.join(' ');
    }
    function driver_infos(driver){
        let infos_html = '';
        if (driver?.member_info) {
            let member_years = years_diff(new Date(driver.member_info.member_since));
            infos_html = '' +
                // '<img src="https://ir-core-sites.iracing.com/members/member_images/world_cup/club_logos/club_'+
                // driver.member_info.club_id.toString().padStart(3, '0') +'_long_0128_web.png" alt="'+ driver.member_info.club_name +'" height="24"> &nbsp; '+
                '<b>'+ driver?.member_info?.country +' </b> &nbsp; '+
                '<span title="Member since: '+ driver.member_info.member_since +'">Member: '+ member_years +' years</span> &nbsp; '+
                'Followers: '+ driver.follow_counts.followers +'/'+ driver.follow_counts.follows +' &nbsp; '+
                '<a target="_blank" href="https://members-ng.iracing.com/web/racing/profile?cust_id='+ driver.cust_id +'" class="driver-link"> Profile </a> &nbsp; '+
                '<a target="_blank" href="https://nyoom.app/search/'+ driver.cust_id +'" class="driver-link"> NYOOM </a> &nbsp; '+
                '<a target="_blank" href="https://www.irstats.net/driver/'+ driver.cust_id +'" class="driver-link"> iRStats </a> &nbsp; '+
				'<a target="_blank" href="https://iracingdata.com/user/careerstats/'+ driver.cust_id +'" class="driver-link"> iRdata </a> &nbsp; '+
                '<a target="_blank" href="https://season-summary.dyczkowski.dev/driver/'+ driver.cust_id +'?category=sports_car" class="driver-link"> SSummary </a> &nbsp; '+
                '<a target="_blank" href="https://simracer-tools.com/seasonstandings/?driver='+ driver.cust_id +'&stats=1" class="driver-link"> SStandings </a> &nbsp; '+
                '<a target="_blank" href="https://members-ng.iracing.com/web/racing/results-stats/results"'+
                ' onclick="navigator.clipboard.writeText('+ driver.cust_id +');"'+
                ' class="driver-link"> Results </a> &nbsp;';
            if (!window_portrait) {
                infos_html += '<a target="_blank" href="'+ CONFIG.API_ENDPOINT +'/drivers?names='+ driver.member_info.display_name +'" class="driver-link"> API </a> &nbsp; ';
            }
        }
        return infos_html;
    }
    function driver_recent_events(driver) {
        let recent_events_html = '';
        let recent_cars_html = '';
        if (driver && driver.recent_events.length > 0) {
            // console.log(driver);
			let recent_events = {
				race: [],
				hosted: [],
				league: [],
                qualify: [],
                practice: [],
                timetrial: [],
                show1: [],
                show2: [],
                show: [],
			};
            let recent_cars = {
                show1: [],
                show2: [],
                show: [],
            };
			let session_style = '';
			driver.recent_events.forEach((recent_event, index) => {
				if (recent_event.subsession_id > 0) {
                    let car = cars_dict[recent_event.car_id];
                    let carname = (car?.make || recent_event.car_name) + ' ' + (car?.abbr || '');
                    let event_type = recent_event.event_type.toLowerCase().replace(/\s/g, '');
                    let event_type1 = recent_event.event_type[0];
                    let event_dt = new Date(recent_event.start_time);
                    let event_date = recent_event.start_time.slice(0, 10);
                    let event_date2 = recent_event.start_time.slice(2, 10);
                    let event_time = recent_event.start_time.slice(12, 16);
                    let event_datetime = event_date + ' ' + event_time;
                    let event_datetime2 = event_date2 + ' ' + event_time;
                    let event_pos = '';
                    // console.log(event_type);
                    switch (event_type) {
                        case 'race': event_pos = ' S'+ (recent_event.starting_position+1) + ' F'+ (recent_event.finish_position+1); break;
                        case 'hosted': event_pos = ' S'+ (recent_event.starting_position+1) + ' F'+ (recent_event.finish_position+1); break;
                        case 'league': event_pos = ' S'+ (recent_event.starting_position+1) + ' F'+ (recent_event.finish_position+1); break;
                        // 'qualify', 'practice', 'timetrial'
                    }
                    let tmp_html = '<span class="driver-link"> &nbsp;';
                    if (window_portrait) {
                        tmp_html += '<span class="border777">'+
                            '<svg class="recent-svg"'+ svg_add[car?.cat] +
                            ' <a target="_blank" class="driver-link monospace" href="https://members-ng.iracing.com/web/racing/profile?subsessionid='+ recent_event.subsession_id +'">'+
                            event_type1 +' '+ event_date2 +'</a>'+
                            '&nbsp; <a target="_blank" class="driver-link" href="https://members.iracing.com/membersite/member/EventResult.do?subsessionid='+ recent_event.subsession_id +'">'+
                            carname + event_pos +'&nbsp;</a> </span>';
                    } else {
                        tmp_html += '<span title="'+ recent_event.event_type +' '+ event_datetime2 +' '+ recent_event.event_name +'" class="border777">'+
                            '<svg class="recent-svg"'+ svg_add[car?.cat] +
                            ' <a target="_blank" class="driver-link monospace" href="https://members-ng.iracing.com/web/racing/profile?subsessionid='+ recent_event.subsession_id +'">'+
                            event_type1 +' '+ event_datetime2 +'</a>'+
                            '&nbsp; <a target="_blank" class="driver-link" href="https://members.iracing.com/membersite/member/EventResult.do?subsessionid='+ recent_event.subsession_id +'">'+
                            recent_event.car_name +' @ '+ recent_event.track.track_name + event_pos +'&nbsp;</a> </span>';
                    }
                    // console.log(tmp_html);
                    recent_events[event_type] = recent_events[event_type] || [];
                    recent_events[event_type].push(tmp_html);
                    if (show_recent_type[event_type] == 1) {
                        recent_events.show1.push(tmp_html);
                        ArrayAddUniqueString(recent_cars.show1, carname);
                    } else if (show_recent_type[event_type] == 2) {
                        recent_events.show2.push(tmp_html);
                        ArrayAddUniqueString(recent_cars.show2, carname);
                    }
				}
			});
            // console.log(driver.member_info.display_name);
            // console.log(recent_events.show1.length);
            if (recent_events.show1.length > 0) {
                for (let i = 0; i < recent_events.show1.length && recent_events.show.length < show_max_recent_events; i++) {
                    recent_events.show.push(recent_events.show1[i]);
                }
            } else {
                for (let i = 0; i < recent_events.show2.length && recent_events.show.length < show_max_recent_events; i++) {
                    recent_events.show.push(recent_events.show2[i]);
                }
            }
            if (recent_cars.show1.length > 0) {
                for (let i = 0; i < recent_cars.show1.length && recent_cars.show.length < show_max_recent_cars; i++) {
                    ArrayAddUniqueString(recent_cars.show, recent_cars.show1[i]);
                }
            } else {
                for (let i = 0; i < recent_cars.show2.length && recent_cars.show.length < show_max_recent_cars; i++) {
                    ArrayAddUniqueString(recent_cars.show, recent_cars.show2[i]);
                }
            }
            // console.log(recent_cars);
            // console.log(recent_events);
            recent_cars_html += '<span>'+ recent_cars.show.join(', ') +'</span>';
			recent_events_html += '<span class="fs90">'+ recent_events.show.join('<br>') +'</span>';
		} else {
            recent_cars_html += '<b> No recent cars. </b>';
			recent_events_html += '<b> No recent events. </b>';
		}
        // console.log(recent_events_html);
        return {
            cars: recent_cars_html,
            events: recent_events_html,
        };
    }
    function getCarInfoById(carId, jsonData) {
        const carData = {};
        for (const car of jsonData) {
            carData[car.car_id] = {
                carNameAbbreviated: car.car_name_abbreviated,
                firstCategory: car.categories[0]
            };
        }
        return carData[carId] || null;
    }
    function render(data, author_wrap){
        // Process each unique driver in the data
        Object.keys(data).forEach(driverName => {
            const member = data[driverName];

            // Get all elements associated with this driver
            const associatedElements = RequestDeduplicationManager.getElementsForDriver(driverName);

            if (associatedElements.length === 0) {
                console.warn(`No elements found for driver: ${driverName}`);
                return;
            }

            // Update all elements for this driver
            RequestDeduplicationManager.updateAllElementsForDriver(driverName, (element, currentDriver) => {
                // Find the author element that contains this loading element
                let author = element.closest('.Author') || element.parentElement;
                while (author && !author.classList.contains('Author')) {
                    author = author.parentElement;
                }

                if (!author) {
                    console.warn(`Could not find author element for driver: ${currentDriver}`);
                    return;
                }

                let driver_stats = '';

                try {
                    // Check if this driver has an error
                    if (member && member.error) {
                        // Use enhanced ErrorHandler for individual driver error display
                        ErrorHandler.showIndividualDriverError(currentDriver, member.errorMessage);
                        return;
                    } else if (member?.member_info) {
                        // Normal rendering for successful data
                        let driver_recent = driver_recent_events(member);
                        driver_stats += '<span class="fwn theme-font-color">'+ driver_infos(member) + '</span>';
                        driver_stats += '<div class="dispflex fs90">'+ driver_licenses(member) + '</div>';
                        driver_stats += '<div class="dispflex theme-font-color">'

                        // Generate unique ID for this specific element instance
                        const elementId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);

                        driver_stats += '<div id="recent_switch_'+ elementId +'" class="noselect"> <b> Recent: </b>&nbsp;</div>';
                        driver_stats += '<div id="recent_cars_html_'+ elementId +'" class="fwn" style="display: inline;">';
                        if (show_max_recent_cars > 0) {
                            driver_stats += driver_recent.cars;
                        } else {
                            driver_stats += 'No recent cars!';
                        }
                        driver_stats += '</div><div id="recent_events_html_'+ elementId +'" class="fwn" style="display: none;">';
                        if (show_max_recent_events > 0) {
                            driver_stats += driver_recent.events;
                        } else {
                            driver_stats += 'No recent events!';
                        }
                        driver_stats += '</div>';

                        // Add event listener for this specific instance
                        setTimeout(() => {
                            const recent_switch = document.querySelector('#recent_switch_'+ elementId);
                            if (recent_switch) {
                                recent_switch.addEventListener('click', function() {
                                    const recent_events_html = document.querySelector('#recent_events_html_'+ elementId);
                                    const recent_cars_html = document.querySelector('#recent_cars_html_'+ elementId);
                                    if (recent_events_html && recent_cars_html) {
                                        if (recent_events_html.style.display == 'none') {
                                            recent_events_html.style.display = 'inline';
                                            recent_cars_html.style.display = 'none';
                                        } else {
                                            recent_events_html.style.display = 'none';
                                            recent_cars_html.style.display = 'inline';
                                        }
                                    }
                                });
                            }
                        }, 100);

                    } else if (!member) {
                        // Driver not found in response - use enhanced ErrorHandler
                        ErrorHandler.showIndividualDriverError(currentDriver, 'Stats failed to load');
                        return;
                    } else {
                        // Data exists but member_info is missing - use enhanced ErrorHandler
                        console.log("Error: member.member_info is undefined or null for driver: " + JSON.stringify(currentDriver));
                        ErrorHandler.showIndividualDriverError(currentDriver, 'Stats failed to load');
                        return;
                    }
                } catch(error) {
                    // Handle rendering errors gracefully using enhanced ErrorHandler
                    const errorInfo = ErrorHandler.handleIndividualDriverError(error, currentDriver);
                    const errorMessage = errorInfo.message +
                        ' <a target="_blank" href="'+ CONFIG.API_ENDPOINT +'/drivers?names='+ currentDriver +'"> JSON </a>';
                    ErrorHandler.showIndividualDriverError(currentDriver, errorMessage);
                    console.log('Render error for driver:', currentDriver);
                    return;
                }

                // Use LoadingManager to properly clean up the loading state and replace content
                const statsHtml = '<div id="driver_infos" class="fwb fs12" >'+ driver_stats +'</div>';
                LoadingManager.hideLoadingForElement(element, statsHtml);
            });
        });
    };

    // Progressive driver rendering function for individual driver display
    function renderProgressiveDriver(driverName, driverData) {
        if (!driverName || !driverData) {
            console.warn('renderProgressiveDriver: Missing required parameters');
            return false;
        }

        console.log(`Progressive rendering for driver: ${driverName}`);

        // Get all elements associated with this driver
        const elements = RequestDeduplicationManager.getElementsForDriver(driverName);

        if (elements.length === 0) {
            console.warn(`renderProgressiveDriver: No elements found for driver ${driverName}`);
            return false;
        }

        // Use the existing render function but only for this specific driver
        render(driverData, document.getElementsByClassName('AuthorWrap'));

        return true;
    }

    // Concurrent individual driver data fetching with progressive display
    // Replaces batch API approach with individual concurrent requests
    async function fetchDriverData(driverNames) {
        if (!Array.isArray(driverNames) || driverNames.length === 0) {
            console.warn('fetchDriverData: Invalid driver names provided');
            return {};
        }

        console.log(`Starting concurrent individual requests for ${driverNames.length} drivers: ${driverNames.join(', ')}`);

        // Reset concurrent request metrics for this batch
        ErrorHandler.resetConcurrentMetrics();

        try {
            // Step 1: Check cache for each driver individually
            const cachedData = {};
            const uncachedNames = [];

            driverNames.forEach(name => {
                const cached = CacheManager.get(name);
                if (cached) {
                    cachedData[name] = cached;
                    // Mark cached drivers as successful in metrics
                    ErrorHandler.markDriverSuccess(name, 0); // 0ms for cached data
                    console.log(`Cache hit for driver: ${name}`);
                } else {
                    uncachedNames.push(name);
                    console.log(`Cache miss for driver: ${name}`);
                }
            });

            // Step 2: Display cached drivers immediately using progressive display
            if (Object.keys(cachedData).length > 0) {
                console.log(`Displaying ${Object.keys(cachedData).length} cached drivers immediately`);

                // Render cached data immediately with progressive display
                Object.keys(cachedData).forEach(driverName => {
                    const driverData = { [driverName]: cachedData[driverName] };

                    // Get elements associated with this driver
                    const elements = RequestDeduplicationManager.getElementsForDriver(driverName);
                    if (elements.length > 0) {
                        // Use progressive display to show cached data immediately
                        setTimeout(() => {
                            renderProgressiveDriver(driverName, driverData);
                        }, 0);
                    }
                });
            }

            // Step 3: If all drivers are cached, return immediately
            if (uncachedNames.length === 0) {
                console.log('All drivers found in cache, no individual API requests needed');
                return cachedData;
            }

            // Step 4: Make concurrent individual requests for uncached drivers
            // This replaces the old batch API call with individual concurrent requests
            console.log(`Making concurrent individual requests for ${uncachedNames.length} uncached drivers`);

            // Create individual request promises for each driver (replaces batch API)
            const requestPromises = uncachedNames.map(driverName =>
                makeIndividualDriverRequest(driverName)
            );

            // Use Promise.allSettled to handle individual failures without failing the entire batch
            const results = await Promise.allSettled(requestPromises);

            // Process results and combine into single response object
            const apiData = {};

            results.forEach((result, index) => {
                const driverName = uncachedNames[index];

                if (result.status === 'fulfilled') {
                    // Successful individual request - merge driver data
                    if (result.value && typeof result.value === 'object') {
                        Object.assign(apiData, result.value);
                        ErrorHandler.markDriverSuccess(driverName);
                    } else {
                        // Invalid response format
                        apiData[driverName] = {
                            error: true,
                            errorType: 'data',
                            errorMessage: 'Invalid response format',
                            driverName: driverName
                        };
                        ErrorHandler.handleIndividualDriverError(new Error('Invalid response format'), driverName);
                    }
                } else {
                    // Failed individual request - create error entry
                    const error = result.reason;
                    apiData[driverName] = {
                        error: true,
                        errorType: ErrorHandler.categorizeError(error),
                        errorMessage: ErrorHandler.getErrorMessage(ErrorHandler.categorizeError(error)),
                        driverName: driverName,
                        originalError: error
                    };
                    ErrorHandler.handleIndividualDriverError(error, driverName);
                }
            });

            // Step 5: Cache individual driver responses as they complete
            Object.keys(apiData).forEach(driverName => {
                const driverData = apiData[driverName];

                if (driverData && !driverData.error && typeof driverData === 'object') {
                    // Cache successful individual responses
                    CacheManager.set(driverName, driverData);
                    console.log(`Cached successful individual response for driver: ${driverName}`);
                }
            });

            // Step 6: Combine cached and individual API data
            const combinedData = { ...cachedData, ...apiData };

            console.log(`Concurrent individual fetch completed: ${Object.keys(cachedData).length} cached, ${Object.keys(apiData).length} from individual API requests`);

            return combinedData;

        } catch (error) {
            console.error('fetchDriverData concurrent individual request error:', error);
            ErrorHandler.logError(error, { context: 'concurrent_individual_fetch' });

            // Fallback to cached data if available
            const fallbackData = {};
            driverNames.forEach(name => {
                const cached = CacheManager.get(name);
                if (cached) {
                    fallbackData[name] = cached;
                } else {
                    // Create error entry for uncached drivers
                    const errorInfo = ErrorHandler.handleIndividualDriverError(error, name);
                    fallbackData[name] = {
                        error: true,
                        errorType: errorInfo.type,
                        errorMessage: errorInfo.message,
                        driverName: name,
                        originalError: error
                    };
                }
            });

            return fallbackData;
        }
    }

    // Individual driver request function with prioritization and metrics logging (replaces batch API calls)
    async function makeIndividualDriverRequest(driverName) {
        let requestRecord = null;

        // Start metrics tracking
        if (typeof RequestMetricsLogger !== 'undefined') {
            requestRecord = RequestMetricsLogger.startRequest(driverName, 'individual', false);
        }

        try {
            let result;

            // Use RequestPrioritizer if available for prioritized requests
            if (typeof RequestPrioritizer !== 'undefined' && RequestPrioritizer.createPrioritizedRequest) {
                console.log(`Creating prioritized request for driver: ${driverName}`);

                // Create prioritized request using RequestPrioritizer
                result = await new Promise((resolve, reject) => {
                    RequestPrioritizer.createPrioritizedRequest(
                        driverName,
                        async (name) => {
                            return await makeStandardIndividualRequest(name);
                        },
                        {
                            canDefer: true,
                            maxRetries: 3,
                            timeout: 10000
                        }
                    ).then(resolve).catch(reject);
                });
            } else {
                // Fallback to standard individual request
                console.log(`Creating standard request for driver: ${driverName}`);
                result = await makeStandardIndividualRequest(driverName);
            }

            // Complete metrics tracking for successful request
            if (requestRecord && typeof RequestMetricsLogger !== 'undefined') {
                RequestMetricsLogger.completeRequest(requestRecord, result);
            }

            return result;

        } catch (error) {
            // Record retry attempts in metrics if this is a retry
            if (requestRecord && typeof RequestMetricsLogger !== 'undefined' && error.attempt) {
                RequestMetricsLogger.recordRetry(requestRecord, error, error.attempt);
            }

            // Record failed request in metrics
            if (requestRecord && typeof RequestMetricsLogger !== 'undefined') {
                RequestMetricsLogger.failRequest(requestRecord, error);
            }

            throw error;
        }
    }

    // Standard individual driver request function (used by prioritizer)
    async function makeStandardIndividualRequest(driverName) {
        const TIMEOUT_MS = 10000; // 10 seconds per request
        const MAX_RETRIES = 3;

        // Create individual API URL for single driver (replaces batch endpoint)
        const createRequestUrl = (name) => {
            return `${CONFIG.API_ENDPOINT}/drivers?names=${encodeURIComponent(name)}`;
        };

        // Check if error is retryable
        const isRetryableError = (error) => {
            if (!error) return false;

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

            return false;
        };

        // Make individual request with retry logic
        const makeRequestWithRetry = async (attempt = 1) => {
            // Create AbortController for timeout handling
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
            }, TIMEOUT_MS);

            try {
                console.log(`Making individual request for driver: ${driverName} (attempt ${attempt})`);

                const response = await fetch(createRequestUrl(driverName), {
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

                // Retry logic for individual requests
                if (isRetryableError(error) && attempt < MAX_RETRIES) {
                    // Exponential backoff: 1s, 2s, 4s
                    const delay = 1000 * Math.pow(2, attempt - 1);
                    console.warn(`Attempt ${attempt} failed for driver ${driverName}. Retrying in ${delay}ms...`);

                    await new Promise(resolve => setTimeout(resolve, delay));
                    return makeRequestWithRetry(attempt + 1);
                }

                // Re-throw error with driver context
                error.driverName = driverName;
                throw error;
            }
        };

        return makeRequestWithRetry();
    }

    // Initialize concurrent loading system components with performance optimization
    console.log('Initializing performance-optimized concurrent individual request system...');

    // Initialize Request Metrics Logger
    if (typeof RequestMetricsLogger !== 'undefined' && RequestMetricsLogger.initialize) {
        RequestMetricsLogger.initialize();
        console.log('RequestMetricsLogger initialized');
    }

    // Initialize Performance Monitor
    if (typeof PerformanceMonitor !== 'undefined' && PerformanceMonitor.initialize) {
        PerformanceMonitor.initialize();
        console.log('PerformanceMonitor initialized');
    }

    // Initialize Request Prioritizer
    if (typeof RequestPrioritizer !== 'undefined' && RequestPrioritizer.initialize) {
        RequestPrioritizer.initialize();
        console.log('RequestPrioritizer initialized');
    }

    // Initialize Progressive Display Manager if available
    if (typeof ProgressiveDisplayManager !== 'undefined' && ProgressiveDisplayManager.initialize) {
        ProgressiveDisplayManager.initialize();
        console.log('ProgressiveDisplayManager initialized');
    }

    // Register driver elements with RequestPrioritizer for visibility tracking
    for (const author of authors) {
        const current_driver = author.getElementsByTagName('a')[0].innerText.replace('Loading\n\n', '');
        const loadingElement = author.querySelector('.loadingstats');

        if (loadingElement && typeof RequestPrioritizer !== 'undefined' && RequestPrioritizer.registerDriverElement) {
            RequestPrioritizer.registerDriverElement(current_driver, loadingElement);
            console.log(`Registered driver element for prioritization: ${current_driver}`);
        }
    }

    // Cleanup expired cache entries on page load
    CacheManager.cleanup();

    // Main execution flow with performance-optimized concurrent individual request system
    console.log('Starting main execution with performance-optimized concurrent loading...');

    // Use performance-prioritized fetch function if available, otherwise fallback to performance-aware, then standard
    const fetchFunction = (typeof fetchDriverDataWithPerformanceAndPrioritization !== 'undefined') ?
        fetchDriverDataWithPerformanceAndPrioritization :
        (typeof fetchDriverDataWithPerformance !== 'undefined') ?
            fetchDriverDataWithPerformance : fetchDriverData;

    fetchFunction(names)
        .then((data) => {
            // Log metrics report after successful completion
            if (typeof RequestMetricsLogger !== 'undefined') {
                setTimeout(() => {
                    RequestMetricsLogger.logMetricsReport();
                }, 500);
            }

            // Progressive display may have already rendered some drivers
            // Only render remaining drivers that haven't been progressively displayed
            const remainingData = {};
            Object.keys(data).forEach(driverName => {
                // Check if this driver was already progressively displayed
                if (typeof ProgressiveDisplayManager !== 'undefined' &&
                    ProgressiveDisplayManager.isDriverComplete &&
                    !ProgressiveDisplayManager.isDriverComplete(driverName)) {
                    remainingData[driverName] = data[driverName];
                } else if (typeof ProgressiveDisplayManager === 'undefined') {
                    // Fallback if ProgressiveDisplayManager is not available
                    remainingData[driverName] = data[driverName];
                }
            });

            // Render any remaining drivers that weren't progressively displayed
            if (Object.keys(remainingData).length > 0) {
                console.log(`Rendering ${Object.keys(remainingData).length} remaining drivers`);
                render(remainingData, author_wrap);
            } else {
                console.log('All drivers were progressively displayed, no additional rendering needed');
            }

            // Log concurrent individual request metrics summary after processing
            setTimeout(() => {
                ErrorHandler.logConcurrentMetricsSummary();
            }, 1000); // Wait a bit for all rendering to complete
        })
        .catch((error) => {
            // This should rarely be reached due to improved error handling in fetchDriverData
            ErrorHandler.logError(error, { context: 'main_execution_individual_requests' });

            // Use LoadingManager to show errors for all drivers with enhanced error handling
            names.forEach(driverName => {
                const elements = RequestDeduplicationManager.getElementsForDriver(driverName);
                elements.forEach(element => {
                    if (typeof LoadingManager !== 'undefined' && LoadingManager.showErrorForElement) {
                        LoadingManager.showErrorForElement(element, 'Stats unavailable - please try again later');
                    } else {
                        // Fallback error display
                        element.innerHTML = '<span class="error-message fs90">Stats unavailable - please try again later</span>';
                    }
                });
            });
        });
    console.log('Fetched')

    // Enhanced cleanup for performance-optimized concurrent loading components on page unload
    window.addEventListener('beforeunload', () => {
        console.log('Page unloading - cleaning up performance-optimized concurrent loading system...');

        // Cleanup RequestMetricsLogger
        if (typeof RequestMetricsLogger !== 'undefined' && RequestMetricsLogger.cleanup) {
            RequestMetricsLogger.cleanup();
        }

        // Cleanup PerformanceMonitor
        if (typeof PerformanceMonitor !== 'undefined' && PerformanceMonitor.cleanup) {
            PerformanceMonitor.cleanup();
        }

        // Cleanup RequestPrioritizer
        if (typeof RequestPrioritizer !== 'undefined' && RequestPrioritizer.cleanup) {
            RequestPrioritizer.cleanup();
        }

        // Cleanup LoadingManager
        if (typeof LoadingManager !== 'undefined' && LoadingManager.cleanup) {
            LoadingManager.cleanup();
        }

        // Cleanup RequestDeduplicationManager
        if (typeof RequestDeduplicationManager !== 'undefined' && RequestDeduplicationManager.cleanup) {
            RequestDeduplicationManager.cleanup();
        }

        // Cleanup ErrorHandler
        if (typeof ErrorHandler !== 'undefined' && ErrorHandler.cleanup) {
            ErrorHandler.cleanup();
        }

        // Cleanup ConcurrentRequestManager
        if (typeof ConcurrentRequestManager !== 'undefined' && ConcurrentRequestManager.cancelPendingRequests) {
            ConcurrentRequestManager.cancelPendingRequests();
        }

        // Cleanup ProgressiveDisplayManager
        if (typeof ProgressiveDisplayManager !== 'undefined' && ProgressiveDisplayManager.cleanup) {
            ProgressiveDisplayManager.cleanup();
        }

        console.log('Performance-optimized concurrent loading system cleanup completed');
    });

    let x = 0
    function addGlobalStyle(css) {
        const head = document.getElementsByTagName('head')[0];
        if (!head) return;
        const style = document.createElement('style');
        style.innerHTML = css;
        head.appendChild(style);
    };
    addGlobalStyle(`
		.driver-link { color: inherit !important; font-size: inherit !important; font-weight: normal !important; /* text-decoration: underline; */ }
		.license-link { border-radius: 6px; font-weight: bold; text-align: center; line-height: 1; margin-right: 0.5em; padding-inline: 0.3em; }
		.license-color-R { border: 1px solid #E1251B; background-color: #F3A8A4; color: #5D1214; }
		.license-color-D { border: 1px solid #FF6600; background-color: #FFC299; color: #692C09; }
		.license-color-C { border: 1px solid #FFCC00; background-color: #FFEB99; color: #50410A; }
		.license-color-B { border: 1px solid #33CC00; background-color: #ADEB99; color: #175509; }
		.license-color-A { border: 1px solid #006EFF; background-color: #99C5FF; color: #032F6F; }
		.license-color-P { border: 1px solid #828287; background-color: #CDCDCF; color: #37373F; }
		.ir-cat-svg { height: 1.4em; vertical-align: text-top; margin-right: 0.3em; }
        .recent-svg { height: 1.4em; vertical-align: text-top; margin-inline: 0.2em; }
		.fwb { font-weight: bold; }
		.fwn { font-weight: normal; }
        .fs12 { font-size: 12px; }
		.fs90 { font-size: 90%; }
		.fs100 { font-size: 100%; }
		.fs110 { font-size: 110%; }
        .theme-font-color { color:var(--theme-font-color); }
        .monospace { font-family: monospace; }
        .hide { display: none; }
        .noselect { user-select: none; }
		.border777 { border: 1px solid #777; border-radius: 6px; }
        .dispflex {display: flex; }
        .Item-Header.Item-Header { flex-wrap: wrap; }
        .ConversationMessage { flex-wrap: wrap; }
        #driver_infos { flex-basis: 100%; }
        .error-message { color: #cc6666; font-style: italic; }

        /* Loading Manager Styles */
        .loading-spinner {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0;
            font-size: 12px;
        }

        .spinner-circle {
            width: 16px;
            height: 16px;
            border: 2px solid #f3f3f3;
            border-top: 2px solid #3498db;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .loading-text {
            color: #666;
            font-size: 90%;
            font-style: italic;
        }

        .loading-progress {
            width: 60px;
            height: 3px;
            background-color: #f0f0f0;
            border-radius: 2px;
            overflow: hidden;
        }

        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #3498db, #2ecc71);
            width: 0%;
            transition: width 0.1s ease-out;
            border-radius: 2px;
        }

        .loading-complete {
            opacity: 0.7;
            transition: opacity 0.15s ease-out;
        }

        .loading-error {
            animation: errorPulse 0.3s ease-out;
        }

        @keyframes errorPulse {
            0% { background-color: transparent; }
            50% { background-color: rgba(204, 102, 102, 0.1); }
            100% { background-color: transparent; }
        }

        /* Enhanced loading states for individual drivers */
        .loadingstats {
            min-height: 20px;
            display: flex;
            align-items: center;
        }
  `);
})();
