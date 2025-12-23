# Deployment Guide

This guide provides comprehensive instructions for deploying the iRacing Forum Browser Addon Drivers Stats infrastructure to different environments.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Deployment Procedures](#deployment-procedures)
- [Post-Deployment Verification](#post-deployment-verification)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Tools
- **Node.js:** Version 18 or higher
- **npm:** Version 8 or higher
- **AWS CLI:** Version 2.x
- **AWS CDK:** Version 2.x
- **jq:** (Optional) For parsing JSON outputs

### Installation Commands
```bash
# Install Node.js (using nvm)
nvm install 18
nvm use 18

# Install AWS CDK globally
npm install -g aws-cdk

# Verify installations
node --version
npm --version
aws --version
cdk --version
```

### AWS Account Setup

1. **Configure AWS Credentials**
   ```bash
   # Configure default profile
   aws configure
   
   # Or configure named profile
   aws configure --profile my-profile
   ```

2. **Verify AWS Access**
   ```bash
   # Check current identity
   aws sts get-caller-identity
   
   # Verify permissions
   aws iam get-user
   ```

3. **Bootstrap CDK** (First time only per account/region)
   ```bash
   # Bootstrap default region
   cdk bootstrap
   
   # Bootstrap specific region
   cdk bootstrap aws://ACCOUNT-ID/REGION
   ```

### Project Setup

1. **Clone Repository**
   ```bash
   git clone <repository-url>
   cd cdk-infrastructure
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

### 3. **Configure Secrets** (Optional but recommended)
   ```bash
   # Copy the template and fill in your credentials
   cp config/secrets.template.json config/secrets.json
   
   # Edit the file with your iRacing OAuth credentials
   # {
   #   "client_id": "your_iracing_client_id",
   #   "client_secret": "your_iracing_client_secret", 
   #   "username": "your_email@example.com",
   #   "password": "your_password"
   # }
   ```

4. **Build Project**
   ```bash
   npm run build
   ```

5. **Run Tests**
   ```bash
   npm test
   ```

## Environment Configuration

### Environment Types

#### Development Environment
- **Purpose:** Local development and testing
- **Characteristics:**
  - Minimal resources
  - Lower costs
  - Relaxed security for testing
  - Frequent deployments

#### Staging Environment
- **Purpose:** Pre-production testing
- **Characteristics:**
  - Production-like configuration
  - Full integration testing
  - Performance testing
  - Security validation

#### Production Environment
- **Purpose:** Live user-facing system
- **Characteristics:**
  - High availability
  - Enhanced monitoring
  - Strict security
  - Change control processes

### Environment-Specific Settings

Create environment configuration files:

**config/dev.json**
```json
{
  "environment": "dev",
  "region": "us-east-1",
  "lambdaMemory": 256,
  "lambdaTimeout": 30,
  "dynamodbBillingMode": "PAY_PER_REQUEST",
  "enablePointInTimeRecovery": false,
  "logRetentionDays": 7,
  "tags": {
    "Environment": "Development",
    "CostCenter": "Engineering",
    "Project": "iRacing-Forum-Browser-Addon-Drivers-Stats"
  }
}
```

**config/staging.json**
```json
{
  "environment": "staging",
  "region": "us-east-1",
  "lambdaMemory": 512,
  "lambdaTimeout": 60,
  "dynamodbBillingMode": "PAY_PER_REQUEST",
  "enablePointInTimeRecovery": true,
  "logRetentionDays": 30,
  "tags": {
    "Environment": "Staging",
    "CostCenter": "Engineering",
    "Project": "iRacing-Forum-Browser-Addon-Drivers-Stats"
  }
}
```

**config/prod.json**
```json
{
  "environment": "prod",
  "region": "us-east-1",
  "lambdaMemory": 1024,
  "lambdaTimeout": 60,
  "dynamodbBillingMode": "PAY_PER_REQUEST",
  "enablePointInTimeRecovery": true,
  "logRetentionDays": 90,
  "tags": {
    "Environment": "Production",
    "CostCenter": "Operations",
    "Project": "iRacing-Forum-Browser-Addon-Drivers-Stats"
  }
}
```

## Deployment Procedures

### Development Environment Deployment

**Quick Deployment:**
```bash
# Deploy with defaults (no secrets update)
./scripts/deploy.sh

# Deploy and automatically configure secrets
./scripts/deploy.sh --update-secrets

# Or explicitly specify environment
./scripts/deploy.sh -e dev --update-secrets
```

**With Custom Options:**
```bash
# Deploy with specific region and profile
./scripts/deploy.sh -e dev -r us-west-2 -p dev-profile

# Deploy with secrets update and custom secrets file
./scripts/deploy.sh -e dev --update-secrets --secrets-file custom/my-secrets.json

# Skip tests for faster deployment
./scripts/deploy.sh -e dev -s

# Dry run to validate changes
./scripts/deploy.sh -e dev -d
```

**Development Workflow:**
1. Make code changes
2. Update secrets if needed: `cp config/secrets.template.json config/secrets.json` (first time)
3. Run local tests: `npm test`
4. Build project: `npm run build`
5. Deploy: `./scripts/deploy.sh -e dev --update-secrets`
6. Test endpoints
7. Iterate as needed

### Staging Environment Deployment

**Standard Deployment:**
```bash
# Full deployment with all checks
./scripts/deploy.sh -e staging -r us-east-1

# With specific AWS profile
./scripts/deploy.sh -e staging -p staging-profile
```

**Pre-Deployment Checklist:**
- [ ] All development tests passing
- [ ] Code reviewed and approved
- [ ] Integration tests prepared
- [ ] Monitoring configured
- [ ] Rollback plan ready

**Staging Deployment Steps:**
1. **Prepare Environment**
   ```bash
   # Ensure clean build
   npm run clean
   npm install
   npm run build
   ```

2. **Run Full Test Suite**
   ```bash
   npm test
   npm run integration-test
   ```

3. **Synthesize and Review**
   ```bash
   # Generate CloudFormation template
   cdk synth -c environment=staging
   
   # Review changes
   cdk diff -c environment=staging
   ```

4. **Deploy**
   ```bash
   ./scripts/deploy.sh -e staging
   ```

5. **Verify Deployment**
   - Check CloudFormation stack status
   - Verify all resources created
   - Test API endpoints
   - Review CloudWatch logs

### Production Environment Deployment

**Production Deployment Process:**

⚠️ **IMPORTANT:** Production deployments require additional approvals and safeguards.

**Pre-Production Checklist:**
- [ ] Staging deployment successful
- [ ] All tests passing (unit, integration, e2e)
- [ ] Performance testing completed
- [ ] Security review completed
- [ ] Change request approved
- [ ] Rollback plan documented
- [ ] Stakeholders notified
- [ ] Maintenance window scheduled (if needed)

**Production Deployment Steps:**

1. **Final Validation**
   ```bash
   # Run full test suite
   npm test
   
   # Verify staging environment
   curl https://staging-api-url/health
   ```

2. **Review Changes**
   ```bash
   # Show what will change
   cdk diff -c environment=prod
   
   # Review CloudFormation template
   cdk synth -c environment=prod > prod-template.yaml
   ```

3. **Deploy to Production**
   ```bash
   # Deploy with force flag (requires typing 'yes')
   ./scripts/deploy.sh -e prod -r us-east-1 --update-secrets
   
   # The script will prompt for confirmation
   # Type 'yes' to proceed
   ```

4. **Monitor Deployment**
   ```bash
   # Watch CloudFormation events
   aws cloudformation describe-stack-events \
     --stack-name CdkInfrastructureStack-prod \
     --max-items 20
   
   # Monitor Lambda logs
   aws logs tail /aws/lambda/ir-auth-prod --follow
   ```

5. **Post-Deployment Verification**
   - See [Post-Deployment Verification](#post-deployment-verification) section

### Multi-Region Deployment

For deploying to multiple regions:

```bash
# Deploy to primary region
./scripts/deploy.sh -e prod -r us-east-1

# Deploy to secondary region
./scripts/deploy.sh -e prod -r eu-west-1

# Deploy to tertiary region
./scripts/deploy.sh -e prod -r ap-southeast-1
```

## Post-Deployment Verification

### Automated Verification

Create a verification script:

**scripts/verify-deployment.sh**
```bash
#!/bin/bash

ENVIRONMENT=$1
API_URL=$2

echo "Verifying deployment for environment: $ENVIRONMENT"

# Test authentication endpoint
echo "Testing /auth endpoint..."
AUTH_RESPONSE=$(curl -s -X POST "$API_URL/auth" -H "Content-Type: application/json")
echo "Auth response: $AUTH_RESPONSE"

# Test custid endpoint
echo "Testing /custid endpoint..."
CUSTID_RESPONSE=$(curl -s "$API_URL/custid?name=TestDriver")
echo "Custid response: $CUSTID_RESPONSE"

# Test drivers endpoint
echo "Testing /drivers endpoint..."
DRIVERS_RESPONSE=$(curl -s "$API_URL/drivers?names=TestDriver1,TestDriver2")
echo "Drivers response: $DRIVERS_RESPONSE"

echo "Verification complete!"
```

### Manual Verification Checklist

#### Infrastructure Verification
- [ ] CloudFormation stack status is `CREATE_COMPLETE` or `UPDATE_COMPLETE`
- [ ] All Lambda functions deployed successfully
- [ ] API Gateway created with correct routes
- [ ] DynamoDB tables created with proper configuration
- [ ] Secrets Manager secret exists and is accessible
- [ ] IAM roles and policies configured correctly

#### Functional Verification
- [ ] Authentication endpoint responds (POST /auth)
- [ ] Customer ID lookup works (GET /custid?name=...)
- [ ] Driver profiles retrieval works (GET /drivers?names=...)
- [ ] Token refresh logic functions correctly
- [ ] Error handling works as expected

#### Security Verification
- [ ] Secrets are not exposed in logs
- [ ] IAM permissions follow least-privilege
- [ ] API Gateway has appropriate security settings
- [ ] DynamoDB encryption enabled
- [ ] CloudWatch logs properly configured

#### Performance Verification
- [ ] Response times meet SLA requirements
- [ ] Lambda cold start times acceptable
- [ ] DynamoDB read/write capacity appropriate
- [ ] API Gateway throttling configured correctly

### Monitoring Setup

**CloudWatch Alarms:**
```bash
# Create Lambda error alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "ir-auth-errors-prod" \
  --alarm-description "Alert on Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1

# Create API Gateway 5xx alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "api-gateway-5xx-prod" \
  --alarm-description "Alert on API Gateway 5xx errors" \
  --metric-name 5XXError \
  --namespace AWS/ApiGateway \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

## Troubleshooting

### Common Deployment Issues

#### Issue: CDK Bootstrap Required
**Error:** `This stack uses assets, so the toolkit stack must be deployed`
**Solution:**
```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

#### Issue: Insufficient IAM Permissions
**Error:** `User is not authorized to perform: cloudformation:CreateStack`
**Solution:** Ensure your IAM user/role has necessary permissions:
- CloudFormation full access
- Lambda full access
- API Gateway full access
- DynamoDB full access
- IAM role creation
- Secrets Manager access

#### Issue: Lambda Deployment Package Too Large
**Error:** `Unzipped size must be smaller than 262144000 bytes`
**Solution:**
- Remove unnecessary dependencies
- Use Lambda layers for large dependencies
- Optimize Python packages

#### Issue: API Gateway CORS Errors
**Error:** `No 'Access-Control-Allow-Origin' header`
**Solution:** Verify CORS configuration in API Gateway construct

#### Issue: Secrets Manager Access Denied
**Error:** `User is not authorized to perform: secretsmanager:GetSecretValue`
**Solution:** Check Lambda IAM role has `secretsmanager:GetSecretValue` permission

### Deployment Logs

**View CloudFormation Events:**
```bash
aws cloudformation describe-stack-events \
  --stack-name CdkInfrastructureStack-prod \
  --max-items 50
```

**View Lambda Logs:**
```bash
# Tail logs in real-time
aws logs tail /aws/lambda/ir-auth-prod --follow

# View recent logs
aws logs tail /aws/lambda/ir-auth-prod --since 1h
```

**View API Gateway Logs:**
```bash
aws logs tail /aws/apigateway/prod --follow
```

### Getting Help

1. **Check Documentation:**
   - [Deployment Guide](./DEPLOYMENT.md)
   - [Rollback Procedures](./ROLLBACK.md)
   - [Troubleshooting Guide](./TROUBLESHOOTING.md)

2. **Review Logs:**
   - CloudFormation events
   - Lambda function logs
   - API Gateway access logs

3. **Contact Support:**
   - Development team
   - DevOps team
   - AWS Support (if needed)

## Best Practices

### Deployment Best Practices
- Always deploy to dev/staging before production
- Use dry runs to preview changes
- Tag all resources appropriately
- Document all configuration changes
- Maintain deployment logs

### Security Best Practices
- Never commit secrets to version control
- Use Secrets Manager for sensitive data
- Follow least-privilege IAM principles
- Enable encryption at rest and in transit
- Regular security audits

### Operational Best Practices
- Monitor all deployments
- Set up appropriate alarms
- Maintain rollback procedures
- Document all changes
- Regular backup verification

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [API Gateway Documentation](https://docs.aws.amazon.com/apigateway/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)