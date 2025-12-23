import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as CdkInfrastructure from '../lib/cdk-infrastructure-stack';

describe('CDK Infrastructure Stack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new CdkInfrastructure.CdkInfrastructureStack(app, 'MyTestStack');
    template = Template.fromStack(stack);
  });

  test('Creates Secrets Manager secret', () => {
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Description: 'iRacing OAuth 2.1 password_limited_flow credentials',
      Name: 'dev-iracing-forum-browser-addon-drivers-stats-oauth-credentials',
    });
  });

  test('Creates DynamoDB tables with correct configuration', () => {
    // ir_auth table
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'dev-iracing-forum-browser-addon-drivers-stats-ir_auth',
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
    });

    // ir_custid table (no TTL)
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'dev-iracing-forum-browser-addon-drivers-stats-ir_custid',
      BillingMode: 'PAY_PER_REQUEST',
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
    });

    // ir_drivers table
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'dev-iracing-forum-browser-addon-drivers-stats-ir_drivers',
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
    });
  });

  test('Creates Lambda functions with correct configuration', () => {
    // ir_auth Lambda
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'python3.9',
      MemorySize: 256,
      Timeout: 30,
      Description: 'iRacing OAuth 2.1 authentication handler',
    });

    // ir_custid Lambda
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'python3.9',
      MemorySize: 256,
      Timeout: 60,
      Description: 'iRacing customer ID lookup handler',
    });

    // ir_drivers Lambda
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'python3.9',
      MemorySize: 512,
      Timeout: 300,
      Description: 'iRacing driver profile lookup handler',
    });
  });

  test('Creates API Gateway with correct routes', () => {
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      Name: 'dev-iracing-forum-browser-addon-drivers-stats-api',
      Description: 'API Gateway for iRacing Forum Browser Addon Drivers Stats Lambda functions',
    });

    // Check for auth, custid, and drivers resources
    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'auth',
    });

    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'custid',
    });

    template.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'drivers',
    });
  });

  test('Configures proper IAM permissions', () => {
    // Lambda execution roles
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
          },
        ],
      },
    });

    // Check that IAM policies exist for Lambda functions (we now have 8 separate policies)
    template.resourceCountIs('AWS::IAM::Policy', 8);
    
    // Check that policies contain DynamoDB permissions
    const policies = template.findResources('AWS::IAM::Policy');
    const policyStatements = Object.values(policies).flatMap((policy: any) => 
      policy.Properties.PolicyDocument.Statement
    );
    
    // Should have DynamoDB permissions
    const hasDynamoDBPermissions = policyStatements.some((statement: any) =>
      statement.Action.some((action: string) => action.startsWith('dynamodb:'))
    );
    expect(hasDynamoDBPermissions).toBe(true);

    // Should have Secrets Manager permissions
    const hasSecretsManagerPermissions = policyStatements.some((statement: any) =>
      statement.Action.some((action: string) => action.startsWith('secretsmanager:'))
    );
    expect(hasSecretsManagerPermissions).toBe(true);

    // Should have Lambda invocation permissions
    const hasLambdaInvokePermissions = policyStatements.some((statement: any) =>
      statement.Action.includes('lambda:InvokeFunction')
    );
    expect(hasLambdaInvokePermissions).toBe(true);
  });

  test('Has proper resource tagging', () => {
    // Check that DynamoDB tables have tags (but don't check exact tag structure since it varies)
    template.resourceCountIs('AWS::DynamoDB::Table', 3);
    
    // Verify that tables have some form of tagging
    const tables = template.findResources('AWS::DynamoDB::Table');
    Object.values(tables).forEach((table: any) => {
      expect(table.Properties.Tags).toBeDefined();
      expect(Array.isArray(table.Properties.Tags)).toBe(true);
      expect(table.Properties.Tags.length).toBeGreaterThan(0);
    });
  });

  test('Outputs important values', () => {
    template.hasOutput('ApiGatewayUrl', {
      Description: 'API Gateway URL for dev environment',
    });

    template.hasOutput('SecretArn', {
      Description: 'iRacing OAuth Secret ARN for dev environment',
    });
  });
});