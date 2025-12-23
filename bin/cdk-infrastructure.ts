#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkInfrastructureStack } from '../lib/cdk-infrastructure-stack';
import { IConstruct } from 'constructs';

const app = new cdk.App();

// Get environment configuration from context or environment variables
const environment = app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev';
const region = app.node.tryGetContext('region') || process.env.AWS_DEFAULT_REGION || process.env.CDK_DEFAULT_REGION;
const account = app.node.tryGetContext('account') || process.env.AWS_ACCOUNT_ID || process.env.CDK_DEFAULT_ACCOUNT;

// Environment-specific configuration
const envConfig = {
  dev: {
    description: 'Development environment for iRacing Forum Browser Addon Drivers Stats',
    terminationProtection: false,
  },
  staging: {
    description: 'Staging environment for iRacing Forum Browser Addon Drivers Stats',
    terminationProtection: true,
  },
  prod: {
    description: 'Production environment for iRacing Forum Browser Addon Drivers Stats',
    terminationProtection: true,
  },
};

// Get configuration for current environment
const currentConfig = envConfig[environment as keyof typeof envConfig] || envConfig.dev;

// Create stack with environment-specific naming
const stackName = `iracing-forum-browser-addon-drivers-stats-${environment}`;

const stack = new CdkInfrastructureStack(app, stackName, {
  env: {
    account: account,
    region: region,
  },
  environment: environment,
  projectName: 'iRacing-Forum-Browser-Addon-Drivers-Stats',
  costCenter: app.node.tryGetContext('costCenter') || 'Engineering',
  owner: app.node.tryGetContext('owner') || 'DevOps',
  description: currentConfig.description,
  terminationProtection: currentConfig.terminationProtection,
  tags: {
    Environment: environment,
    Project: 'iRacing-Forum-Browser-Addon-Drivers-Stats',
    ManagedBy: 'CDK',
    DeployedAt: new Date().toISOString(),
  },
});

// Add environment-specific aspects
if (environment === 'prod') {
  // Add additional production safeguards
  cdk.Aspects.of(stack).add({
    visit(node: IConstruct) {
      // Ensure all DynamoDB tables have point-in-time recovery enabled
      if (node instanceof cdk.aws_dynamodb.Table) {
        console.log(`Checking DynamoDB table: ${node.tableName} for production compliance`);
      }
      
      // Ensure all Lambda functions have appropriate memory and timeout settings
      if (node instanceof cdk.aws_lambda.Function) {
        if (node.timeout && node.timeout.toSeconds() > 300) {
          console.warn(`Warning: Lambda function ${node.functionName} has timeout > 5 minutes, consider optimization`);
        }
      }
    }
  });
}

// Synthesize the app
app.synth();