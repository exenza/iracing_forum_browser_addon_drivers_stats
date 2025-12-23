# Troubleshooting Guide

This guide provides solutions to common issues encountered during deployment and operation of the iRacing Forum Browser Addon Drivers Stats system.

## Table of Contents
- [Deployment Issues](#deployment-issues)
- [Runtime Issues](#runtime-issues)
- [Performance Issues](#performance-issues)
- [Security Issues](#security-issues)
- [Data Issues](#data-issues)
- [Monitoring and Debugging](#monitoring-and-debugging)

## Deployment Issues

### CDK Bootstrap Issues

#### Issue: Stack Uses Assets Error
**Error Message:**
```
This stack uses assets, so the toolkit stack must be deployed to the environment
```

**Cause:** CDK not bootstrapped in target account/region

**Solution:**
```bash
# Bootstrap CDK in current region
cdk bootstrap

# Bootstrap CDK in specific region
cdk bootstrap aws://123456789012/us-east-1

# Bootstrap with specific profile
cdk bootstrap --profile my-profile
```

**Verification:**
```bash
aws cloudformation describe-stacks --stack-name CDKToolkit
```

#### Issue: Bootstrap Version Mismatch
**Error Message:**
```
This CDK deployment requires bootstrap stack version 'X', found 'Y'
```

**Solution:**
```bash
# Update bootstrap stack
cdk bootstrap --force

# Check bootstrap version
aws ssm get-parameter --name /cdk-bootstrap/version
```

### IAM Permission Issues

#### Issue: Insufficient CloudFormation Permissions
**Error Message:**
```
User: arn:aws:iam::123456789012:user/username is not authorized to perform: cloudformation:CreateStack
```

**Required Permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "lambda:*",
        "apigateway:*",
        "dynamodb:*",
        "secretsmanager:*",
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:PutRolePolicy",
        "iam:PassRole",
        "logs:*",
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "*"
    }
  ]
}
```

**Solution:**
1. Attach necessary policies to IAM user/role
2. Use administrator access for initial deployment
3. Create custom deployment role with required permissions

#### Issue: Lambda Execution Role Creation Failed
**Error Message:**
```
Cannot create resource of type AWS::IAM::Role
```

**Solution:**
```bash
# Check IAM permissions
aws iam get-user
aws iam list-attached-user-policies --user-name USERNAME

# Verify role creation permissions
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:user/USERNAME \
  --action-names iam:CreateRole \
  --resource-arns "*"
```

### Lambda Deployment Issues

#### Issue: Lambda Package Too Large
**Error Message:**
```
Unzipped size must be smaller than 262144000 bytes
```

**Solutions:**
1. **Remove Unnecessary Dependencies:**
   ```bash
   # Check package size
   du -sh lambda-functions/*/
   
   # Remove dev dependencies
   pip install --no-dev
   ```

2. **Use Lambda Layers:**
   ```typescript
   // In CDK construct
   const layer = new lambda.LayerVersion(this, 'DependenciesLayer', {
     code: lambda.Code.fromAsset('layers/dependencies'),
     compatibleRuntimes: [lambda.Runtime.PYTHON_3_9],
   });
   
   const lambdaFunction = new lambda.Function(this, 'Function', {
     layers: [layer],
     // ... other config
   });
   ```

3. **Optimize Python Packages:**
   ```bash
   # Install only production dependencies
   pip install --target ./package -r requirements.txt --no-deps
   
   # Remove unnecessary files
   find ./package -name "*.pyc" -delete
   find ./package -name "__pycache__" -type d -exec rm -rf {} +
   ```

#### Issue: Lambda Function Timeout During Deployment
**Error Message:**
```
The function could not be created/updated because it exceeded the timeout
```

**Solution:**
```typescript
// Increase timeout in CDK
const lambdaFunction = new lambda.Function(this, 'Function', {
  timeout: Duration.minutes(5), // Increase from default
  // ... other config
});
```

### API Gateway Issues

#### Issue: API Gateway Deployment Failed
**Error Message:**
```
Invalid stage identifier specified
```

**Solution:**
```typescript
// Ensure proper stage configuration
const api = new apigateway.RestApi(this, 'Api', {
  deployOptions: {
    stageName: 'prod',
    description: 'Production stage',
  },
});
```

#### Issue: CORS Configuration Problems
**Error Message:**
```
No 'Access-Control-Allow-Origin' header is present
```

**Solution:**
```typescript
// Configure CORS in API Gateway
const api = new apigateway.RestApi(this, 'Api', {
  defaultCorsPreflightOptions: {
    allowOrigins: apigateway.Cors.ALL_ORIGINS,
    allowMethods: apigateway.Cors.ALL_METHODS,
    allowHeaders: ['Content-Type', 'Authorization'],
  },
});
```

### DynamoDB Issues

#### Issue: DynamoDB Table Already Exists
**Error Message:**
```
Table already exists: ir_auth
```

**Solutions:**
1. **Import Existing Table:**
   ```typescript
   const table = dynamodb.Table.fromTableName(this, 'ExistingTable', 'ir_auth');
   ```

2. **Use Different Table Name:**
   ```typescript
   const table = new dynamodb.Table(this, 'Table', {
     tableName: `ir_auth_${environment}`,
     // ... other config
   });
   ```

3. **Delete Existing Table (Caution!):**
   ```bash
   aws dynamodb delete-table --table-name ir_auth
   ```

## Runtime Issues

### Authentication Issues

#### Issue: OAuth 2.1 Authentication Failing
**Symptoms:**
- 401 Unauthorized responses
- "Invalid client credentials" errors
- Authentication timeouts

**Debugging Steps:**
1. **Check Secrets Manager:**
   ```bash
   # Verify secret exists
   aws secretsmanager describe-secret --secret-id iRacing/OAuth/Credentials
   
   # Check secret value (be careful with output)
   aws secretsmanager get-secret-value --secret-id iRacing/OAuth/Credentials
   ```

2. **Verify Lambda Permissions:**
   ```bash
   # Check Lambda execution role
   aws lambda get-function --function-name ir-auth-prod
   
   # Verify IAM permissions
   aws iam get-role-policy --role-name ir-auth-role --policy-name SecretsManagerPolicy
   ```

3. **Check Lambda Logs:**
   ```bash
   aws logs tail /aws/lambda/ir-auth-prod --since 1h
   ```

**Common Solutions:**
- Verify client_id and client_secret are correct
- Check username/password format (email vs username)
- Ensure proper masking implementation
- Verify iRacing API endpoint URL

#### Issue: Token Refresh Failing
**Symptoms:**
- Expired token errors
- Frequent re-authentication requests
- "Invalid refresh token" errors

**Debugging:**
```python
# Add debug logging to Lambda
import logging
logger = logging.getLogger()
logger.setLevel(logging.DEBUG)

# Log token details (mask sensitive data)
logger.debug(f"Access token expires at: {token_expiry}")
logger.debug(f"Refresh token exists: {bool(refresh_token)}")
```

**Solutions:**
- Check token TTL in DynamoDB
- Verify refresh token storage
- Ensure proper token expiry handling
- Check system clock synchronization

### Inter-Lambda Communication Issues

#### Issue: Lambda Invocation Permissions
**Error Message:**
```
User is not authorized to perform: lambda:InvokeFunction
```

**Solution:**
```typescript
// Grant invocation permissions in CDK
authLambda.grantInvoke(custidLambda);
authLambda.grantInvoke(driversLambda);
```

**Verification:**
```bash
# Check resource-based policy
aws lambda get-policy --function-name ir-auth-prod
```

#### Issue: Lambda Invocation Timeout
**Symptoms:**
- Intermittent failures
- Timeout errors in logs
- Slow response times

**Solutions:**
1. **Increase Timeout:**
   ```typescript
   const lambdaFunction = new lambda.Function(this, 'Function', {
     timeout: Duration.seconds(60), // Increase timeout
   });
   ```

2. **Optimize Code:**
   - Reduce cold start time
   - Cache connections
   - Optimize database queries

3. **Use Async Invocation:**
   ```python
   # Use async invocation for non-critical calls
   lambda_client.invoke(
       FunctionName='ir-auth',
       InvocationType='Event',  # Async
       Payload=json.dumps(payload)
   )
   ```

### DynamoDB Issues

#### Issue: DynamoDB Throttling
**Error Message:**
```
ProvisionedThroughputExceededException
```

**Solutions:**
1. **Enable Auto Scaling:**
   ```typescript
   const table = new dynamodb.Table(this, 'Table', {
     billingMode: dynamodb.BillingMode.ON_DEMAND, // Recommended
   });
   ```

2. **Optimize Queries:**
   ```python
   # Use batch operations
   with table.batch_writer() as batch:
       for item in items:
           batch.put_item(Item=item)
   ```

3. **Implement Exponential Backoff:**
   ```python
   import time
   import random
   
   def retry_with_backoff(func, max_retries=3):
       for attempt in range(max_retries):
           try:
               return func()
           except ClientError as e:
               if e.response['Error']['Code'] == 'ProvisionedThroughputExceededException':
                   wait_time = (2 ** attempt) + random.uniform(0, 1)
                   time.sleep(wait_time)
               else:
                   raise
   ```

#### Issue: DynamoDB Item Not Found
**Symptoms:**
- Empty query results
- KeyError exceptions
- Inconsistent data retrieval

**Debugging:**
```python
# Add detailed logging
logger.info(f"Querying table {table_name} with key: {key}")
response = table.get_item(Key=key)
logger.info(f"DynamoDB response: {response}")

if 'Item' not in response:
    logger.warning(f"Item not found for key: {key}")
```

**Solutions:**
- Verify partition key format
- Check TTL expiration
- Ensure consistent read if needed
- Validate data insertion

## Performance Issues

### Lambda Cold Start Issues

#### Issue: High Cold Start Latency
**Symptoms:**
- First request takes significantly longer
- Intermittent slow responses
- Timeout errors on first invocation

**Solutions:**
1. **Optimize Package Size:**
   ```bash
   # Minimize dependencies
   pip install --target ./package requests boto3 --no-deps
   ```

2. **Use Provisioned Concurrency:**
   ```typescript
   const version = lambdaFunction.currentVersion;
   const alias = new lambda.Alias(this, 'ProdAlias', {
     aliasName: 'prod',
     version,
     provisionedConcurrencyConfig: {
       provisionedConcurrentExecutions: 10,
     },
   });
   ```

3. **Optimize Initialization:**
   ```python
   # Initialize outside handler
   import boto3
   
   # Global initialization
   dynamodb = boto3.resource('dynamodb')
   table = dynamodb.Table('ir_auth')
   
   def lambda_handler(event, context):
       # Handler code here
       pass
   ```

### API Gateway Performance

#### Issue: High API Gateway Latency
**Symptoms:**
- Slow API responses
- Timeout errors
- High response times in CloudWatch

**Solutions:**
1. **Enable Caching:**
   ```typescript
   const api = new apigateway.RestApi(this, 'Api', {
     deployOptions: {
       cachingEnabled: true,
       cacheClusterSize: '0.5',
       cacheTtl: Duration.minutes(5),
     },
   });
   ```

2. **Optimize Lambda Integration:**
   ```typescript
   // Use Lambda proxy integration
   resource.addMethod('GET', new apigateway.LambdaIntegration(lambdaFunction, {
     proxy: true,
   }));
   ```

3. **Configure Throttling:**
   ```typescript
   const api = new apigateway.RestApi(this, 'Api', {
     deployOptions: {
       throttleSettings: {
         rateLimit: 1000,
         burstLimit: 2000,
       },
     },
   });
   ```

## Security Issues

### Secrets Management Issues

#### Issue: Secrets Exposed in Logs
**Symptoms:**
- Sensitive data visible in CloudWatch logs
- Security audit findings
- Compliance violations

**Solutions:**
1. **Mask Sensitive Data:**
   ```python
   def mask_secret(secret):
       if len(secret) <= 4:
           return '*' * len(secret)
       return secret[:2] + '*' * (len(secret) - 4) + secret[-2:]
   
   logger.info(f"Using client_id: {mask_secret(client_id)}")
   ```

2. **Use Structured Logging:**
   ```python
   import json
   
   def log_event(event_type, **kwargs):
       # Remove sensitive fields
       safe_kwargs = {k: v for k, v in kwargs.items() 
                     if k not in ['password', 'client_secret', 'token']}
       logger.info(json.dumps({
           'event_type': event_type,
           **safe_kwargs
       }))
   ```

#### Issue: Secrets Manager Access Denied
**Error Message:**
```
User is not authorized to perform: secretsmanager:GetSecretValue
```

**Solution:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:region:account:secret:iRacing/OAuth/Credentials-*"
    }
  ]
}
```

### IAM Permission Issues

#### Issue: Overly Permissive IAM Policies
**Symptoms:**
- Security audit findings
- Broad resource access
- Wildcard permissions

**Solution:**
```typescript
// Use least-privilege permissions
const lambdaRole = new iam.Role(this, 'LambdaRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  inlinePolicies: {
    DynamoDBPolicy: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
          resources: [table.tableArn],
        }),
      ],
    }),
  },
});
```

## Data Issues

### DynamoDB Data Consistency

#### Issue: Inconsistent Read Results
**Symptoms:**
- Recently written data not appearing
- Intermittent data retrieval failures
- Stale data returned

**Solutions:**
1. **Use Consistent Reads:**
   ```python
   response = table.get_item(
       Key={'username': username},
       ConsistentRead=True
   )
   ```

2. **Implement Retry Logic:**
   ```python
   def get_item_with_retry(table, key, max_retries=3):
       for attempt in range(max_retries):
           response = table.get_item(Key=key, ConsistentRead=True)
           if 'Item' in response:
               return response['Item']
           time.sleep(0.1 * (2 ** attempt))
       return None
   ```

#### Issue: TTL Not Working
**Symptoms:**
- Expired items not being deleted
- Table size growing unexpectedly
- Old data still accessible

**Debugging:**
```bash
# Check TTL configuration
aws dynamodb describe-table --table-name ir_drivers --query 'Table.TimeToLiveDescription'

# Verify TTL attribute format
aws dynamodb scan --table-name ir_drivers --projection-expression "id,ttl" --max-items 5
```

**Solutions:**
- Ensure TTL attribute is Unix timestamp
- Verify TTL is enabled on table
- Check attribute name matches configuration

## Monitoring and Debugging

### CloudWatch Logs

#### Viewing Logs
```bash
# Tail logs in real-time
aws logs tail /aws/lambda/ir-auth-prod --follow

# View logs from specific time
aws logs tail /aws/lambda/ir-auth-prod --since 2h

# Filter logs by pattern
aws logs filter-log-events \
  --log-group-name /aws/lambda/ir-auth-prod \
  --filter-pattern "ERROR"
```

#### Log Analysis
```bash
# Count error occurrences
aws logs filter-log-events \
  --log-group-name /aws/lambda/ir-auth-prod \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s)000 \
  | jq '.events | length'

# Extract specific error messages
aws logs filter-log-events \
  --log-group-name /aws/lambda/ir-auth-prod \
  --filter-pattern "ProvisionedThroughputExceededException" \
  | jq -r '.events[].message'
```

### CloudWatch Metrics

#### Key Metrics to Monitor
- Lambda Duration
- Lambda Errors
- Lambda Throttles
- API Gateway 4XXError
- API Gateway 5XXError
- DynamoDB ConsumedReadCapacityUnits
- DynamoDB ConsumedWriteCapacityUnits

#### Creating Custom Metrics
```python
import boto3

cloudwatch = boto3.client('cloudwatch')

def put_custom_metric(metric_name, value, unit='Count'):
    cloudwatch.put_metric_data(
        Namespace='iRacing/Lambda',
        MetricData=[
            {
                'MetricName': metric_name,
                'Value': value,
                'Unit': unit,
                'Dimensions': [
                    {
                        'Name': 'Environment',
                        'Value': os.environ.get('ENVIRONMENT', 'unknown')
                    }
                ]
            }
        ]
    )
```

### X-Ray Tracing

#### Enable X-Ray Tracing
```typescript
const lambdaFunction = new lambda.Function(this, 'Function', {
  tracing: lambda.Tracing.ACTIVE,
  // ... other config
});
```

#### Add X-Ray Annotations
```python
from aws_xray_sdk.core import xray_recorder

@xray_recorder.capture('oauth_authentication')
def authenticate_user(credentials):
    xray_recorder.put_annotation('user_id', credentials['username'])
    xray_recorder.put_metadata('credentials', {
        'client_id': credentials['client_id'][:8] + '...'
    })
    # Authentication logic here
```

### Health Checks

#### Lambda Health Check
```python
def health_check():
    """Basic health check for Lambda function"""
    try:
        # Test DynamoDB connection
        table.get_item(Key={'username': 'health_check'})
        
        # Test Secrets Manager connection
        secrets_client.get_secret_value(SecretId='iRacing/OAuth/Credentials')
        
        return {
            'statusCode': 200,
            'body': json.dumps({'status': 'healthy'})
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'status': 'unhealthy', 'error': str(e)})
        }
```

#### API Gateway Health Check
```bash
# Test API endpoints
curl -X GET https://api-url/health
curl -X POST https://api-url/auth -d '{"test": true}'
```

## Getting Additional Help

### Log Analysis Tools
- AWS CloudWatch Insights
- AWS X-Ray Service Map
- Third-party log aggregation tools

### AWS Support Resources
- AWS Support Center
- AWS Forums
- AWS Documentation
- AWS Well-Architected Framework

### Internal Resources
- Development team documentation
- Runbooks and playbooks
- Incident response procedures
- Architecture decision records

### Emergency Procedures
1. Check [ROLLBACK.md](./ROLLBACK.md) for rollback procedures
2. Contact on-call engineer
3. Escalate to development team lead
4. Engage AWS Support if needed

Remember: When in doubt, prioritize system stability and user experience. It's better to rollback and investigate than to leave a broken system in production.