import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface LambdaConstructProps {
  readonly irAuthTable: dynamodb.Table;
  readonly irCustidTable: dynamodb.Table;
  readonly irDriversTable: dynamodb.Table;
  readonly iracingSecret: secretsmanager.ISecret;
  readonly iracingSecretName: string;
  readonly environment?: string;
}

export class LambdaConstruct extends Construct {
  public readonly irAuthFunction: lambda.Function;
  public readonly irCustidFunction: lambda.Function;
  public readonly irDriversFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaConstructProps) {
    super(scope, id);

    const environment = props.environment || 'dev';

    // Create custom IAM roles first to avoid circular dependencies
    const authRole = this.createLambdaRole('IRAuthFunctionRole');
    const custidRole = this.createLambdaRole('IRCustidFunctionRole');
    const driversRole = this.createLambdaRole('IRDriversFunctionRole');

    // Common Lambda configuration - minimal to avoid circular dependencies
    const commonProps = {
      runtime: lambda.Runtime.PYTHON_3_9,
      environment: {
        REGION: cdk.Stack.of(this).region,
        ENVIRONMENT: environment,
      },
      // Explicitly disable features that cause automatic permissions
      tracing: lambda.Tracing.DISABLED,
      // Disable automatic log group creation to avoid circular dependencies
      logRetention: undefined,
    };

    // ir_auth Lambda function - handles OAuth 2.1 authentication
    this.irAuthFunction = new lambda.Function(this, 'IRAuthFunction', {
      ...commonProps,
      code: lambda.Code.fromAsset('lambda/ir_auth'),
      handler: 'lambda_function.lambda_handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      description: 'iRacing OAuth 2.1 authentication handler',
      role: authRole,
      environment: {
        ...commonProps.environment,
        IR_AUTH_TABLE_NAME: props.irAuthTable.tableName,
        IRACING_SECRET_NAME: props.iracingSecretName,
      },
    });

    // ir_custid Lambda function - handles customer ID lookups
    this.irCustidFunction = new lambda.Function(this, 'IRCustidFunction', {
      ...commonProps,
      code: lambda.Code.fromAsset('lambda/ir_custid'),
      handler: 'lambda_function.lambda_handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      description: 'iRacing customer ID lookup handler',
      role: custidRole,
      environment: {
        ...commonProps.environment,
        IR_AUTH_TABLE_NAME: props.irAuthTable.tableName,
        IR_CUSTID_TABLE_NAME: props.irCustidTable.tableName,
        IRACING_SECRET_NAME: props.iracingSecretName,
      },
    });

    // ir_drivers Lambda function - handles driver profile lookups
    this.irDriversFunction = new lambda.Function(this, 'IRDriversFunction', {
      ...commonProps,
      code: lambda.Code.fromAsset('lambda/ir_drivers'),
      handler: 'lambda_function.lambda_handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(300),
      description: 'iRacing driver profile lookup handler',
      role: driversRole,
      environment: {
        ...commonProps.environment,
        IR_AUTH_TABLE_NAME: props.irAuthTable.tableName,
        IR_CUSTID_TABLE_NAME: props.irCustidTable.tableName,
        IR_DRIVERS_TABLE_NAME: props.irDriversTable.tableName,
        IRACING_SECRET_NAME: props.iracingSecretName,
      },
    });

    // Configure permissions after all functions are created
    this.configureDynamoDBPermissions(props);
    this.configureSecretsManagerPermissions(props);
    this.configureInterLambdaPermissions();

    // Add function ARNs to environment variables after all functions are created
    this.addFunctionArnsToEnvironment();

    // Add comprehensive tags for better resource management
    this.addResourceTags(environment);
  }

  private createLambdaRole(roleName: string): iam.Role {
    return new iam.Role(this, roleName, {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });
  }

  private configureDynamoDBPermissions(props: LambdaConstructProps): void {
    // Create IAM policies manually to avoid circular dependencies from CDK grant methods
    
    // ir_auth function needs read/write access to ir_auth table only
    const authTablePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:BatchGetItem',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:Query',
        'dynamodb:GetItem',
        'dynamodb:Scan',
        'dynamodb:ConditionCheckItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:DescribeTable'
      ],
      resources: [props.irAuthTable.tableArn, `${props.irAuthTable.tableArn}/index/*`]
    });
    this.irAuthFunction.role?.attachInlinePolicy(new iam.Policy(this, 'AuthTablePolicy', {
      statements: [authTablePolicy]
    }));

    // ir_custid function needs:
    // - Read access to ir_auth table (for token lookup)
    // - Read/write access to ir_custid table (for caching)
    const custidAuthTableReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:BatchGetItem',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:Query',
        'dynamodb:GetItem',
        'dynamodb:Scan',
        'dynamodb:ConditionCheckItem',
        'dynamodb:DescribeTable'
      ],
      resources: [props.irAuthTable.tableArn, `${props.irAuthTable.tableArn}/index/*`]
    });

    const custidTablePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:BatchGetItem',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:Query',
        'dynamodb:GetItem',
        'dynamodb:Scan',
        'dynamodb:ConditionCheckItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:DescribeTable'
      ],
      resources: [props.irCustidTable.tableArn, `${props.irCustidTable.tableArn}/index/*`]
    });

    this.irCustidFunction.role?.attachInlinePolicy(new iam.Policy(this, 'CustidTablePolicy', {
      statements: [custidAuthTableReadPolicy, custidTablePolicy]
    }));

    // ir_drivers function needs:
    // - Read access to ir_auth table (for token lookup)
    // - Read access to ir_custid table (for customer ID lookup)
    // - Read/write access to ir_drivers table (for profile caching)
    const driversAuthTableReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:BatchGetItem',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:Query',
        'dynamodb:GetItem',
        'dynamodb:Scan',
        'dynamodb:ConditionCheckItem',
        'dynamodb:DescribeTable'
      ],
      resources: [props.irAuthTable.tableArn, `${props.irAuthTable.tableArn}/index/*`]
    });

    const driversCustidTableReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:BatchGetItem',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:Query',
        'dynamodb:GetItem',
        'dynamodb:Scan',
        'dynamodb:ConditionCheckItem',
        'dynamodb:DescribeTable'
      ],
      resources: [props.irCustidTable.tableArn, `${props.irCustidTable.tableArn}/index/*`]
    });

    const driversTablePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:BatchGetItem',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:Query',
        'dynamodb:GetItem',
        'dynamodb:Scan',
        'dynamodb:ConditionCheckItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:DescribeTable'
      ],
      resources: [props.irDriversTable.tableArn, `${props.irDriversTable.tableArn}/index/*`]
    });

    this.irDriversFunction.role?.attachInlinePolicy(new iam.Policy(this, 'DriversTablePolicy', {
      statements: [driversAuthTableReadPolicy, driversCustidTableReadPolicy, driversTablePolicy]
    }));
  }

  private configureSecretsManagerPermissions(props: LambdaConstructProps): void {
    // Create IAM policy for Secrets Manager access manually to avoid circular dependencies
    const secretsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret'
      ],
      resources: [props.iracingSecret.secretArn]
    });

    // All functions need read access to the iRacing OAuth secret
    const functions = [this.irAuthFunction, this.irCustidFunction, this.irDriversFunction];
    const roleNames = ['AuthSecretsPolicy', 'CustidSecretsPolicy', 'DriversSecretsPolicy'];
    
    functions.forEach((func, index) => {
      func.role?.attachInlinePolicy(new iam.Policy(this, roleNames[index], {
        statements: [secretsPolicy]
      }));
    });
  }

  private configureInterLambdaPermissions(): void {
    // Create IAM policies for inter-Lambda invocation without using grantInvoke
    // to avoid circular dependencies
    
    // ir_custid function can invoke ir_auth function for token refresh
    const custidInvokeAuthPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [this.irAuthFunction.functionArn],
    });
    this.irCustidFunction.role?.attachInlinePolicy(new iam.Policy(this, 'CustidInvokeAuthPolicy', {
      statements: [custidInvokeAuthPolicy]
    }));

    // ir_drivers function can invoke both ir_auth and ir_custid functions
    const driversInvokeAuthPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [this.irAuthFunction.functionArn],
    });
    const driversInvokeCustidPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [this.irCustidFunction.functionArn],
    });
    this.irDriversFunction.role?.attachInlinePolicy(new iam.Policy(this, 'DriversInvokePolicy', {
      statements: [driversInvokeAuthPolicy, driversInvokeCustidPolicy]
    }));
  }

  private addFunctionArnsToEnvironment(): void {
    // Add function ARNs to environment variables for inter-Lambda invocation
    // This is done after all functions are created to avoid circular dependencies
    
    this.irCustidFunction.addEnvironment('IR_AUTH_FUNCTION_ARN', this.irAuthFunction.functionArn);
    this.irDriversFunction.addEnvironment('IR_AUTH_FUNCTION_ARN', this.irAuthFunction.functionArn);
    this.irDriversFunction.addEnvironment('IR_CUSTID_FUNCTION_ARN', this.irCustidFunction.functionArn);
  }

  private addResourceTags(environment: string): void {
    const functions = [this.irAuthFunction, this.irCustidFunction, this.irDriversFunction];
    
    functions.forEach(func => {
      cdk.Tags.of(func).add('Component', 'Lambda');
      cdk.Tags.of(func).add('Service', 'iRacing');
      cdk.Tags.of(func).add('Environment', environment);
      cdk.Tags.of(func).add('ManagedBy', 'CDK');
      cdk.Tags.of(func).add('Project', 'iRacing-Forum-Browser-Addon-Drivers-Stats');
    });
  }

  /**
   * Get function ARNs for use in other constructs (e.g., API Gateway)
   */
  public getFunctionArns(): { [key: string]: string } {
    return {
      irAuth: this.irAuthFunction.functionArn,
      irCustid: this.irCustidFunction.functionArn,
      irDrivers: this.irDriversFunction.functionArn,
    };
  }

  /**
   * Get function names for use in other constructs
   */
  public getFunctionNames(): { [key: string]: string } {
    return {
      irAuth: this.irAuthFunction.functionName,
      irCustid: this.irCustidFunction.functionName,
      irDrivers: this.irDriversFunction.functionName,
    };
  }
}