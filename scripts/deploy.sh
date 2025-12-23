#!/bin/bash

# iRacing Forum Browser Addon Drivers Stats - CDK Deployment Script
# This script handles deployment to multiple environments with proper validation and rollback capabilities

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="dev"
REGION=""
PROFILE=""
SKIP_TESTS=false
SKIP_BUILD=false
DRY_RUN=false
FORCE_DEPLOY=false
ROLLBACK_ON_FAILURE=true
UPDATE_SECRETS=false
SECRETS_FILE="config/secrets.json"

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

print_debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -e, --environment ENV    Environment name (dev, staging, prod) [default: dev]"
    echo "  -r, --region REGION      AWS region to deploy to"
    echo "  -p, --profile PROFILE    AWS profile to use"
    echo "  -s, --skip-tests         Skip running tests before deployment"
    echo "  -b, --skip-build         Skip building the project"
    echo "  -d, --dry-run           Perform a dry run (synthesize only)"
    echo "  -f, --force             Force deployment without confirmation"
    echo "  --no-rollback           Disable automatic rollback on failure"
    echo "  --update-secrets        Update Secrets Manager with credentials from config file"
    echo "  --secrets-file FILE     Path to secrets JSON file [default: config/secrets.json]"
    echo "  -h, --help              Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Deploy to dev environment"
    echo "  $0 -e prod -r eu-central-1          # Deploy to prod in Frankfurt"
    echo "  $0 -e staging -p my-aws-profile     # Deploy to staging with specific profile"
    echo "  $0 -d                                # Dry run (synthesize only)"
    echo "  $0 -e prod -f                       # Force deploy to prod without confirmation"
    echo "  $0 --update-secrets                  # Deploy and update secrets from config file"
    echo "  $0 --secrets-file custom/secrets.json # Use custom secrets file"
    echo ""
    echo "Environment Variables:"
    echo "  AWS_PROFILE              AWS profile to use (overridden by -p)"
    echo "  AWS_DEFAULT_REGION       AWS region to use (overridden by -r)"
    echo "  CDK_DEFAULT_ACCOUNT      AWS account ID for deployment"
    echo "  ENVIRONMENT              Environment name (overridden by -e)"
}

# Function to validate prerequisites
validate_prerequisites() {
    print_status "Validating prerequisites..."
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ to continue."
        exit 1
    fi
    
    # Check Node.js version
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ $NODE_VERSION -lt 18 ]]; then
        print_warning "Node.js version $NODE_VERSION detected. CDK recommends Node.js 18+."
    fi
    
    # Check if npm is installed
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed. Please install npm to continue."
        exit 1
    fi
    
    # Check if AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install AWS CLI v2 to continue."
        exit 1
    fi
    
    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK is not installed. Please run 'npm install -g aws-cdk' to continue."
        exit 1
    fi
    
    print_status "Prerequisites validation completed successfully"
}

# Function to validate AWS credentials and permissions
validate_aws_credentials() {
    print_status "Validating AWS credentials..."
    
    # Check if AWS CLI is configured
    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        print_error "AWS CLI is not configured or credentials are invalid"
        print_error "Please run 'aws configure' or set up your AWS credentials"
        exit 1
    fi
    
    # Get current AWS account and region
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    CURRENT_REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
    
    if [[ -n "$REGION" ]]; then
        CURRENT_REGION="$REGION"
    fi
    
    print_status "AWS Account: $ACCOUNT_ID"
    print_status "AWS Region: $CURRENT_REGION"
    
    # Validate permissions for production deployments
    if [[ "$ENVIRONMENT" == "prod" ]]; then
        print_status "Validating production deployment permissions..."
        
        # Check if user has necessary permissions (basic check)
        if ! aws iam get-user > /dev/null 2>&1 && ! aws sts get-caller-identity --query Arn --output text | grep -q "role"; then
            print_warning "Unable to verify IAM permissions. Ensure you have sufficient permissions for production deployment."
        fi
    fi
}

# Function to validate environment
validate_environment() {
    if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
        print_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or prod."
        exit 1
    fi
    
    print_status "Deploying to environment: $ENVIRONMENT"
}

# Function to build the project
build_project() {
    if [[ "$SKIP_BUILD" == true ]]; then
        print_warning "Skipping build step"
        return 0
    fi
    
    print_status "Building CDK project..."
    npm run build
    
    if [[ $? -ne 0 ]]; then
        print_error "Build failed"
        exit 1
    fi
    
    print_status "Build completed successfully"
}

# Function to run tests
run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        print_warning "Skipping tests"
        return 0
    fi
    
    print_status "Running tests..."
    npm test
    
    if [[ $? -ne 0 ]]; then
        print_error "Tests failed"
        if [[ "$FORCE_DEPLOY" != true ]]; then
            exit 1
        else
            print_warning "Continuing deployment despite test failures (--force flag used)"
        fi
    fi
    
    print_status "Tests completed successfully"
}

# Function to check CDK bootstrap status
check_bootstrap() {
    print_status "Checking CDK bootstrap status..."
    
    # Check if CDK is bootstrapped in the target region
    if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region "$CURRENT_REGION" > /dev/null 2>&1; then
        print_warning "CDK not bootstrapped in region $CURRENT_REGION"
        print_status "Bootstrapping CDK..."
        
        cdk bootstrap --region "$CURRENT_REGION"
        
        if [[ $? -ne 0 ]]; then
            print_error "CDK bootstrap failed"
            exit 1
        fi
        
        print_status "CDK bootstrap completed successfully"
    else
        print_status "CDK is already bootstrapped in region $CURRENT_REGION"
    fi
}

# Function to update Secrets Manager with credentials
update_secrets_manager() {
    if [[ "$UPDATE_SECRETS" != true ]]; then
        return 0
    fi
    
    print_status "Updating Secrets Manager with OAuth credentials..."
    
    # Check if secrets file exists
    if [[ ! -f "$SECRETS_FILE" ]]; then
        print_error "Secrets file not found: $SECRETS_FILE"
        print_error "Please create the secrets file or use --secrets-file to specify a different path"
        exit 1
    fi
    
    # Validate JSON format
    if ! jq empty "$SECRETS_FILE" 2>/dev/null; then
        print_error "Invalid JSON format in secrets file: $SECRETS_FILE"
        exit 1
    fi
    
    # Extract credentials from file
    CLIENT_ID=$(jq -r '.client_id' "$SECRETS_FILE")
    CLIENT_SECRET=$(jq -r '.client_secret' "$SECRETS_FILE")
    USERNAME=$(jq -r '.username' "$SECRETS_FILE")
    PASSWORD=$(jq -r '.password' "$SECRETS_FILE")
    
    # Validate required fields
    if [[ "$CLIENT_ID" == "null" || "$CLIENT_SECRET" == "null" || "$USERNAME" == "null" || "$PASSWORD" == "null" ]]; then
        print_error "Missing required fields in secrets file. Required: client_id, client_secret, username, password"
        exit 1
    fi
    
    # Create secret name based on environment (matching CDK naming convention)
    SECRET_NAME="$ENVIRONMENT-iracing-forum-browser-addon-drivers-stats-oauth-credentials"
    
    # Create the secret value JSON
    SECRET_VALUE=$(jq -n \
        --arg client_id "$CLIENT_ID" \
        --arg client_secret "$CLIENT_SECRET" \
        --arg username "$USERNAME" \
        --arg password "$PASSWORD" \
        '{
            client_id: $client_id,
            client_secret: $client_secret,
            username: $username,
            password: $password
        }')
    
    print_status "Creating/updating secret: $SECRET_NAME"
    
    # Check if secret already exists
    if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" > /dev/null 2>&1; then
        print_status "Secret exists, updating value..."
        aws secretsmanager update-secret \
            --secret-id "$SECRET_NAME" \
            --secret-string "$SECRET_VALUE" \
            --description "iRacing OAuth 2.1 credentials for $ENVIRONMENT environment"
        
        if [[ $? -eq 0 ]]; then
            print_status "✅ Secret updated successfully"
        else
            print_error "❌ Failed to update secret"
            exit 1
        fi
    else
        print_status "Secret does not exist, creating new secret..."
        aws secretsmanager create-secret \
            --name "$SECRET_NAME" \
            --description "iRacing OAuth 2.1 credentials for $ENVIRONMENT environment" \
            --secret-string "$SECRET_VALUE"
        
        if [[ $? -eq 0 ]]; then
            print_status "✅ Secret created successfully"
        else
            print_error "❌ Failed to create secret"
            exit 1
        fi
    fi
    
    # Mask sensitive information in output
    print_status "Secret configuration:"
    echo "  Secret Name: $SECRET_NAME"
    echo "  Client ID: ${CLIENT_ID:0:8}..."
    echo "  Username: ${USERNAME:0:3}***@${USERNAME##*@}"
    echo "  Region: $CURRENT_REGION"
}

# Function to perform dry run
perform_dry_run() {
    print_status "Performing dry run (synthesize only)..."
    
    # Check if we need to import existing secret
    SECRET_NAME="$ENVIRONMENT-iracing-forum-browser-addon-drivers-stats-oauth-credentials"
    IMPORT_EXISTING="false"
    
    # Check if secret exists and is not marked for deletion
    if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" > /dev/null 2>&1; then
        SECRET_STATUS=$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --query 'DeletedDate' --output text 2>/dev/null || echo "None")
        if [[ "$SECRET_STATUS" == "None" ]]; then
            print_status "Existing secret found: $SECRET_NAME - will import instead of create"
            IMPORT_EXISTING="true"
        else
            print_warning "Secret exists but is marked for deletion - will attempt to restore"
            # Try to restore the secret
            if aws secretsmanager restore-secret --secret-id "$SECRET_NAME" > /dev/null 2>&1; then
                print_status "Secret restored successfully"
                IMPORT_EXISTING="true"
            else
                print_warning "Failed to restore secret - will create new one"
            fi
        fi
    else
        print_status "No existing secret found - will create new one"
    fi
    
    print_debug "Using importExistingSecret: $IMPORT_EXISTING"
    
    # Get the directory where this script is located
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    
    # Change to project directory and run CDK
    (cd "$PROJECT_DIR" && cdk synth \
        --context environment="$ENVIRONMENT" \
        --context region="$CURRENT_REGION" \
        --context account="$ACCOUNT_ID" \
        --context importExistingSecret="$IMPORT_EXISTING")
    
    if [[ $? -eq 0 ]]; then
        print_status "Dry run completed successfully!"
        print_status "CloudFormation template synthesized without errors"
    else
        print_error "Dry run failed"
        exit 1
    fi
}

# Function to get user confirmation for production deployments
get_user_confirmation() {
    if [[ "$ENVIRONMENT" == "prod" && "$FORCE_DEPLOY" != true ]]; then
        echo ""
        print_warning "⚠️  PRODUCTION DEPLOYMENT WARNING ⚠️"
        echo "You are about to deploy to the PRODUCTION environment."
        echo "This will affect live systems and users."
        echo ""
        echo "Deployment details:"
        echo "  Environment: $ENVIRONMENT"
        echo "  AWS Account: $ACCOUNT_ID"
        echo "  AWS Region: $CURRENT_REGION"
        echo ""
        read -p "Are you sure you want to continue? (type 'yes' to confirm): " confirmation
        
        if [[ "$confirmation" != "yes" ]]; then
            print_status "Deployment cancelled by user"
            exit 0
        fi
    fi
}

# Function to deploy the stack
deploy_stack() {
    STACK_NAME="iracing-forum-browser-addon-drivers-stats-$ENVIRONMENT"
    print_status "Deploying stack: $STACK_NAME"
    
    # Check if we need to import existing secret
    SECRET_NAME="$ENVIRONMENT-iracing-forum-browser-addon-drivers-stats-oauth-credentials"
    IMPORT_EXISTING="false"
    
    # Check if secret exists and is not marked for deletion
    if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" > /dev/null 2>&1; then
        SECRET_STATUS=$(aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --query 'DeletedDate' --output text 2>/dev/null || echo "None")
        if [[ "$SECRET_STATUS" == "None" ]]; then
            print_status "Existing secret found: $SECRET_NAME - will import instead of create"
            IMPORT_EXISTING="true"
        else
            print_warning "Secret exists but is marked for deletion - will attempt to restore"
            # Try to restore the secret
            if aws secretsmanager restore-secret --secret-id "$SECRET_NAME" > /dev/null 2>&1; then
                print_status "Secret restored successfully"
                IMPORT_EXISTING="true"
            else
                print_warning "Failed to restore secret - will create new one"
            fi
        fi
    else
        print_status "No existing secret found - will create new one"
    fi
    
    print_debug "Using importExistingSecret: $IMPORT_EXISTING"
    
    # Create outputs file name
    OUTPUTS_FILE="outputs-$ENVIRONMENT-$(date +%Y%m%d-%H%M%S).json"
    
    # Get the directory where this script is located
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    
    # Change to project directory and run CDK deploy
    (cd "$PROJECT_DIR" && cdk deploy \
        --context environment="$ENVIRONMENT" \
        --context region="$CURRENT_REGION" \
        --context account="$ACCOUNT_ID" \
        --context importExistingSecret="$IMPORT_EXISTING" \
        --require-approval never \
        --outputs-file "$OUTPUTS_FILE" \
        --rollback="$ROLLBACK_ON_FAILURE")
    
    DEPLOY_EXIT_CODE=$?
    
    if [[ $DEPLOY_EXIT_CODE -eq 0 ]]; then
        print_status "✅ Deployment completed successfully!"
        
        # Show outputs (outputs file is in project directory)
        OUTPUTS_PATH="$PROJECT_DIR/$OUTPUTS_FILE"
        if [[ -f "$OUTPUTS_PATH" ]]; then
            print_status "Stack outputs saved to: $OUTPUTS_FILE"
            echo ""
            print_status "Key stack outputs:"
            
            # Extract and display key outputs
            if command -v jq &> /dev/null; then
                API_URL=$(jq -r ".[\"$STACK_NAME\"].ApiGatewayUrl // \"N/A\"" "$OUTPUTS_PATH")
                SECRET_ARN=$(jq -r ".[\"$STACK_NAME\"].SecretArn // \"N/A\"" "$OUTPUTS_PATH")
                
                echo "  API Gateway URL: $API_URL"
                echo "  Secret ARN: $SECRET_ARN"
            else
                print_warning "jq not installed. Full outputs available in $OUTPUTS_FILE"
            fi
        fi
        
        # Post-deployment instructions
        show_post_deployment_instructions
        
    else
        print_error "❌ Deployment failed with exit code $DEPLOY_EXIT_CODE"
        
        if [[ "$ROLLBACK_ON_FAILURE" == true ]]; then
            print_status "Automatic rollback should have been triggered"
        fi
        
        print_error "Check the CloudFormation console for detailed error information"
        exit $DEPLOY_EXIT_CODE
    fi
}

# Function to show post-deployment instructions
show_post_deployment_instructions() {
    echo ""
    print_status "🎉 Deployment completed successfully!"
    echo ""
    print_warning "📋 Next steps:"
    if [[ "$UPDATE_SECRETS" == true ]]; then
        echo "✅ Secrets Manager has been automatically configured with OAuth credentials"
        echo ""
        echo "1. Verify the secret configuration in AWS Console:"
        echo "   - Secret Name: $ENVIRONMENT-iracing-forum-browser-addon-drivers-stats-oauth-credentials"
        echo "   - Region: $CURRENT_REGION"
        echo ""
        echo "2. Test the API endpoints:"
    else
        echo "1. Update the Secrets Manager secret with your iRacing OAuth credentials:"
        echo "   - Client ID, Client Secret, Username (email), and Password"
        echo "   - Use AWS Console or run: ./scripts/deploy.sh --update-secrets"
        echo ""
        echo "2. Test the API endpoints:"
    fi
    echo "   - POST /auth - OAuth authentication"
    echo "   - GET /custid?name=<driver_name> - Customer ID lookup"
    echo "   - GET /drivers?names=<driver_names> - Driver profiles"
    echo ""
    echo "3. Monitor CloudWatch logs for any issues:"
    echo "   - Check Lambda function logs"
    echo "   - Monitor API Gateway access logs"
    echo ""
    echo "4. Set up monitoring and alerting if this is a production deployment"
    echo ""
    
    if [[ "$ENVIRONMENT" == "prod" ]]; then
        print_warning "🔒 Production deployment reminders:"
        echo "- Verify all secrets are properly configured"
        echo "- Test all endpoints thoroughly"
        echo "- Monitor system performance and error rates"
        echo "- Ensure backup and disaster recovery procedures are in place"
    fi
}

# Function to handle script cleanup
cleanup() {
    print_debug "Performing cleanup..."
    # Add any cleanup tasks here if needed
}

# Set up trap for cleanup
trap cleanup EXIT

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -p|--profile)
            PROFILE="$2"
            shift 2
            ;;
        -s|--skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        -b|--skip-build)
            SKIP_BUILD=true
            shift
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -f|--force)
            FORCE_DEPLOY=true
            shift
            ;;
        --no-rollback)
            ROLLBACK_ON_FAILURE=false
            shift
            ;;
        --update-secrets)
            UPDATE_SECRETS=true
            shift
            ;;
        --secrets-file)
            SECRETS_FILE="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Main execution flow
main() {
    echo "🚀 iRacing Forum Browser Addon Drivers Stats - CDK Deployment"
    echo "=============================================="
    echo ""
    
    # Set AWS profile if provided
    if [[ -n "$PROFILE" ]]; then
        export AWS_PROFILE="$PROFILE"
        print_status "Using AWS profile: $PROFILE"
    fi
    
    # Set AWS region if provided
    if [[ -n "$REGION" ]]; then
        export AWS_DEFAULT_REGION="$REGION"
        print_status "Using AWS region: $REGION"
    fi
    
    # Validate inputs and prerequisites
    validate_environment
    validate_prerequisites
    validate_aws_credentials
    
    # Build and test
    build_project
    run_tests
    
    # Handle dry run
    if [[ "$DRY_RUN" == true ]]; then
        perform_dry_run
        exit 0
    fi
    
    # Check CDK bootstrap
    check_bootstrap
    
    # Update Secrets Manager if requested
    update_secrets_manager
    
    # Get user confirmation for production
    get_user_confirmation
    
    # Deploy the stack
    deploy_stack
}

# Run main function
main