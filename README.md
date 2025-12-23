
# iRacing Forum Browser Addon Drivers Stats

Click on the link below and copy the text in a new tampermonkey script:
- [https://raw.githubusercontent.com/exenza/iracing_forum_browser_addon_drivers_stats/refs/heads/main/tampermonkey/ifbads.js](ifbdas.js)


If you want to deploy the backend keep reading and update the endpoint in the script.

# iRacing Forum Browser Addon Drivers Stats - CDK Infrastructure

This CDK project converts the existing iRacing API integration from manually managed AWS resources to CDK-managed infrastructure while migrating from environment variables to Secrets Manager for credential storage.

## Architecture

The project consists of:
- **3 Lambda functions**: ir_auth, ir_custid, ir_drivers
- **3 DynamoDB tables**: ir_auth, ir_custid, ir_drivers
- **1 Secrets Manager secret**: iRacing OAuth credentials
- **1 API Gateway**: REST API with routes to Lambda functions

## Prerequisites

- Node.js 20.x
- AWS CLI configured with appropriate permissions
- AWS CDK CLI installed (`npm install -g aws-cdk`)

## Project Structure

```
├── lib/
│   ├── constructs/
│   │   ├── secrets-construct.ts      # Secrets Manager setup
│   │   ├── database-construct.ts     # DynamoDB tables
│   │   ├── lambda-construct.ts       # Lambda functions
│   │   └── api-gateway-construct.ts  # API Gateway setup
│   └── cdk-infrastructure-stack.ts   # Main stack
├── lambda/
│   ├── ir_auth/                      # Authentication Lambda
│   ├── ir_custid/                    # Customer ID Lambda
│   └── ir_drivers/                   # Driver profiles Lambda
└── test/                             # CDK tests
```

## Setup and Deployment

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the project**:
   ```bash
   npm run build
   ```

3. **Bootstrap CDK (first time only)**:
   ```bash
   cdk bootstrap
   ```

4. **Deploy the stack**:
   ```bash
   # Development environment
   cdk deploy

   # Production environment
   cdk deploy --context environment=prod
   ```

## Configuration

### Environment Variables

The stack supports environment-specific configuration:
- `environment`: Environment name (dev, staging, prod)
- `tableNamePrefix`: Prefix for DynamoDB table names

### Secrets Manager

After deployment, you need to update the Secrets Manager secret with your iRacing OAuth credentials:

```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret",
  "username": "your_email@example.com",
  "password": "your_password"
}
```

## Useful Commands

- `npm run build`   - Compile TypeScript to JavaScript
- `npm run watch`   - Watch for changes and compile
- `npm run test`    - Perform Jest unit tests
- `cdk deploy`      - Deploy this stack to your default AWS account/region
- `cdk diff`        - Compare deployed stack with current state
- `cdk synth`       - Emits the synthesized CloudFormation template
- `cdk destroy`     - Destroy the stack

## Testing

Run the test suite:
```bash
npm test
```

## Migration from Existing Infrastructure

1. **Backup existing data**: Export data from existing DynamoDB tables
2. **Deploy CDK stack**: Deploy the new infrastructure
3. **Update secrets**: Configure the Secrets Manager secret
4. **Import data**: Import data to new DynamoDB tables
5. **Update DNS/routing**: Point traffic to new API Gateway
6. **Clean up**: Remove old infrastructure after validation

## Security Considerations

- All Lambda functions use least-privilege IAM roles
- Secrets are stored in AWS Secrets Manager with encryption
- API Gateway has throttling enabled
- DynamoDB tables have point-in-time recovery enabled
- All resources are tagged for better management
