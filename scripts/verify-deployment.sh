#!/bin/bash

# iRacing Forum Browser Addon Drivers Stats - Deployment Verification Script
# This script performs comprehensive end-to-end testing of the deployed infrastructure

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ENVIRONMENT=${1:-"dev"}
API_URL=""
STACK_NAME="CdkInfrastructureStack-${ENVIRONMENT}"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Verify prerequisites
verify_prerequisites() {
    print_status "Verifying prerequisites..."
    
    if ! command_exists aws; then
        print_error "AWS CLI not found. Please install AWS CLI."
        exit 1
    fi
    
    if ! command_exists jq; then
        print_warning "jq not found. JSON parsing will be limited."
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        print_error "AWS credentials not configured or invalid."
        exit 1
    fi
    
    print_success "Prerequisites verified"
}

# Get stack outputs
get_stack_outputs() {
    print_status "Retrieving stack outputs..."
    
    local outputs
    outputs=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query 'Stacks[0].Outputs' \
        --output json 2>/dev/null || echo "[]")
    
    if [ "$outputs" = "[]" ]; then
        print_error "Stack $STACK_NAME not found or has no outputs"
        exit 1
    fi
    
    # Extract API Gateway URL
    if command_exists jq; then
        API_URL=$(echo "$outputs" | jq -r '.[] | select(.OutputKey=="ApiGatewayUrl") | .OutputValue')
        if [ "$API_URL" = "null" ] || [ -z "$API_URL" ]; then
            print_error "API Gateway URL not found in stack outputs"
            exit 1
        fi
    else
        print_warning "jq not available, skipping API URL extraction"
        return 1
    fi
    
    print_success "Stack outputs retrieved. API URL: $API_URL"
}

# Verify infrastructure components
verify_infrastructure() {
    print_status "Verifying infrastructure components..."
    
    # Check CloudFormation stack status
    local stack_status
    stack_status=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [[ "$stack_status" != "CREATE_COMPLETE" && "$stack_status" != "UPDATE_COMPLETE" ]]; then
        print_error "Stack status is $stack_status (expected CREATE_COMPLETE or UPDATE_COMPLETE)"
        return 1
    fi
    
    print_success "CloudFormation stack status: $stack_status"
    
    # Check Lambda functions
    local functions=("${ENVIRONMENT}-iracing-ir_auth" "${ENVIRONMENT}-iracing-ir_custid" "${ENVIRONMENT}-iracing-ir_drivers")
    for func in "${functions[@]}"; do
        if aws lambda get-function --function-name "$func" >/dev/null 2>&1; then
            print_success "Lambda function $func exists"
        else
            print_error "Lambda function $func not found"
            return 1
        fi
    done
    
    # Check DynamoDB tables
    local tables=("${ENVIRONMENT}-iracing-ir_auth" "${ENVIRONMENT}-iracing-ir_custid" "${ENVIRONMENT}-iracing-ir_drivers")
    for table in "${tables[@]}"; do
        if aws dynamodb describe-table --table-name "$table" >/dev/null 2>&1; then
            print_success "DynamoDB table $table exists"
        else
            print_error "DynamoDB table $table not found"
            return 1
        fi
    done
    
    # Check Secrets Manager secret
    local secret_name="${ENVIRONMENT}-iracing-oauth-credentials"
    if aws secretsmanager describe-secret --secret-id "$secret_name" >/dev/null 2>&1; then
        print_success "Secrets Manager secret $secret_name exists"
    else
        print_error "Secrets Manager secret $secret_name not found"
        return 1
    fi
    
    print_success "Infrastructure verification completed"
}

# Test API endpoints
test_api_endpoints() {
    print_status "Testing API endpoints..."
    
    if [ -z "$API_URL" ]; then
        print_warning "API URL not available, skipping endpoint tests"
        return 0
    fi
    
    # Test CORS preflight for auth endpoint
    print_status "Testing CORS preflight for /auth endpoint..."
    local cors_response
    cors_response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X OPTIONS \
        -H "Origin: https://example.com" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        "${API_URL}auth" || echo "000")
    
    if [ "$cors_response" = "204" ] || [ "$cors_response" = "200" ]; then
        print_success "CORS preflight for /auth: HTTP $cors_response"
    else
        print_warning "CORS preflight for /auth: HTTP $cors_response (expected 204 or 200)"
    fi
    
    # Test auth endpoint (POST)
    print_status "Testing /auth endpoint (POST)..."
    local auth_response
    auth_response=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        "${API_URL}auth" || echo "000")
    
    if [ "$auth_response" = "200" ] || [ "$auth_response" = "401" ] || [ "$auth_response" = "503" ]; then
        print_success "Auth endpoint: HTTP $auth_response (expected 200, 401, or 503 without credentials)"
    else
        print_warning "Auth endpoint: HTTP $auth_response"
    fi
    
    # Test custid endpoint (GET)
    print_status "Testing /custid endpoint (GET)..."
    local custid_response
    custid_response=$(curl -s -o /dev/null -w "%{http_code}" \
        "${API_URL}custid?name=TestDriver" || echo "000")
    
    if [ "$custid_response" = "200" ] || [ "$custid_response" = "401" ] || [ "$custid_response" = "404" ] || [ "$custid_response" = "503" ]; then
        print_success "Custid endpoint: HTTP $custid_response (expected 200, 401, 404, or 503)"
    else
        print_warning "Custid endpoint: HTTP $custid_response"
    fi
    
    # Test drivers endpoint (GET)
    print_status "Testing /drivers endpoint (GET)..."
    local drivers_response
    drivers_response=$(curl -s -o /dev/null -w "%{http_code}" \
        "${API_URL}drivers?names=TestDriver1,TestDriver2" || echo "000")
    
    if [ "$drivers_response" = "200" ] || [ "$drivers_response" = "401" ] || [ "$drivers_response" = "404" ] || [ "$drivers_response" = "503" ]; then
        print_success "Drivers endpoint: HTTP $drivers_response (expected 200, 401, 404, or 503)"
    else
        print_warning "Drivers endpoint: HTTP $drivers_response"
    fi
    
    print_success "API endpoint testing completed"
}

# Check CloudWatch logs
check_logs() {
    print_status "Checking CloudWatch logs for recent errors..."
    
    local log_groups=("/aws/lambda/${ENVIRONMENT}-iracing-ir_auth" "/aws/lambda/${ENVIRONMENT}-iracing-ir_custid" "/aws/lambda/${ENVIRONMENT}-iracing-ir_drivers")
    
    for log_group in "${log_groups[@]}"; do
        if aws logs describe-log-groups --log-group-name-prefix "$log_group" --query 'logGroups[0].logGroupName' --output text >/dev/null 2>&1; then
            print_success "Log group $log_group exists"
            
            # Check for recent ERROR logs (last 10 minutes)
            local start_time=$(($(date +%s) * 1000 - 600000))
            local error_count
            error_count=$(aws logs filter-log-events \
                --log-group-name "$log_group" \
                --start-time "$start_time" \
                --filter-pattern "ERROR" \
                --query 'length(events)' \
                --output text 2>/dev/null || echo "0")
            
            if [ "$error_count" -gt 0 ]; then
                print_warning "Found $error_count ERROR log entries in $log_group (last 10 minutes)"
            else
                print_success "No recent ERROR logs in $log_group"
            fi
        else
            print_warning "Log group $log_group not found (may not have been invoked yet)"
        fi
    done
}

# Main verification function
main() {
    echo "=========================================="
    echo "iRacing Forum Browser Addon Drivers Stats Verification"
    echo "Environment: $ENVIRONMENT"
    echo "=========================================="
    
    verify_prerequisites
    get_stack_outputs
    verify_infrastructure
    test_api_endpoints
    check_logs
    
    echo "=========================================="
    print_success "Verification completed successfully!"
    echo "=========================================="
    
    if [ -n "$API_URL" ]; then
        echo ""
        echo "API Gateway URL: $API_URL"
        echo "Available endpoints:"
        echo "  POST $API_URL/auth"
        echo "  GET  $API_URL/custid?name=<driver_name>"
        echo "  GET  $API_URL/drivers?names=<comma_separated_names>"
        echo ""
    fi
}

# Show usage if help requested
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    echo "Usage: $0 [ENVIRONMENT]"
    echo ""
    echo "Arguments:"
    echo "  ENVIRONMENT    Environment name (dev, staging, prod) [default: dev]"
    echo ""
    echo "Examples:"
    echo "  $0              # Verify dev environment"
    echo "  $0 staging      # Verify staging environment"
    echo "  $0 prod         # Verify production environment"
    exit 0
fi

# Run main function
main "$@"