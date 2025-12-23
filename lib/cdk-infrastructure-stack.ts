import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SecretsConstruct } from './constructs/secrets-construct';
import { DatabaseConstruct } from './constructs/database-construct';
import { LambdaConstruct } from './constructs/lambda-construct';
import { ApiGatewayConstruct } from './constructs/api-gateway-construct';

export interface CdkInfrastructureStackProps extends cdk.StackProps {
  readonly environment?: string;
  readonly tableNamePrefix?: string;
  readonly projectName?: string;
  readonly costCenter?: string;
  readonly owner?: string;
}

export class CdkInfrastructureStack extends cdk.Stack {
  public readonly secretsConstruct: SecretsConstruct;
  public readonly databaseConstruct: DatabaseConstruct;
  public readonly lambdaConstruct: LambdaConstruct;
  public readonly apiGatewayConstruct: ApiGatewayConstruct;

  constructor(scope: Construct, id: string, props?: CdkInfrastructureStackProps) {
    super(scope, id, props);

    // Environment-specific configuration
    const environment = props?.environment || this.node.tryGetContext('environment') || 'dev';
    const projectName = props?.projectName || 'iRacing-Forum-Browser-Addon-Drivers-Stats';
    const costCenter = props?.costCenter || this.node.tryGetContext('costCenter') || 'Engineering';
    const owner = props?.owner || this.node.tryGetContext('owner') || 'DevOps';
    
    // Resource naming configuration
    const resourcePrefix = `${environment}-iracing-forum-browser-addon-drivers-stats`;
    const tablePrefix = props?.tableNamePrefix || `${resourcePrefix}-`;

    // Validate environment
    const validEnvironments = ['dev', 'staging', 'prod'];
    if (!validEnvironments.includes(environment)) {
      throw new Error(`Invalid environment: ${environment}. Must be one of: ${validEnvironments.join(', ')}`);
    }

    const importExistingSecret = this.node.tryGetContext('importExistingSecret') === 'true';
    this.secretsConstruct = new SecretsConstruct(this, 'SecretsConstruct', {
      secretName: `${resourcePrefix}-oauth-credentials`,
      importExisting: importExistingSecret,
    });

    // Create DynamoDB construct
    this.databaseConstruct = new DatabaseConstruct(this, 'DatabaseConstruct', {
      tableNamePrefix: tablePrefix,
    });

    // Create Lambda construct
    this.lambdaConstruct = new LambdaConstruct(this, 'LambdaConstruct', {
      irAuthTable: this.databaseConstruct.irAuthTable,
      irCustidTable: this.databaseConstruct.irCustidTable,
      irDriversTable: this.databaseConstruct.irDriversTable,
      iracingSecret: this.secretsConstruct.iracingSecret,
      iracingSecretName: this.secretsConstruct.secretName,
      environment: environment,
    });

    // Create API Gateway construct
    this.apiGatewayConstruct = new ApiGatewayConstruct(this, 'ApiGatewayConstruct', {
      irAuthFunction: this.lambdaConstruct.irAuthFunction,
      irCustidFunction: this.lambdaConstruct.irCustidFunction,
      irDriversFunction: this.lambdaConstruct.irDriversFunction,
      apiName: `${resourcePrefix}-api`,
      environment: environment,
    });

    // Add comprehensive stack-level tags
    this.addStackTags(environment, projectName, costCenter, owner);

    // Create stack outputs
    this.createStackOutputs(environment);
  }

  private addStackTags(environment: string, projectName: string, costCenter: string, owner: string): void {
    const tags = {
      'Environment': environment,
      'Project': projectName,
      'ManagedBy': 'CDK',
      'CostCenter': costCenter,
      'Owner': owner,
      'Service': 'iRacing-Forum-Browser-Addon-Drivers-Stats',
      'Component': 'Infrastructure',
      'CreatedBy': 'CDK-Infrastructure-Stack',
      'LastModified': new Date().toISOString().split('T')[0], // YYYY-MM-DD format
    };

    Object.entries(tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }

  private createStackOutputs(environment: string): void {
    // API Gateway outputs
    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.apiGatewayConstruct.api.url,
      description: `API Gateway URL for ${environment} environment`,
      exportName: `${this.stackName}-ApiGatewayUrl`,
    });

    new cdk.CfnOutput(this, 'ApiGatewayId', {
      value: this.apiGatewayConstruct.api.restApiId,
      description: `API Gateway ID for ${environment} environment`,
      exportName: `${this.stackName}-ApiGatewayId`,
    });

    // Secrets Manager outputs
    new cdk.CfnOutput(this, 'SecretArn', {
      value: this.secretsConstruct.iracingSecret.secretArn,
      description: `iRacing OAuth Secret ARN for ${environment} environment`,
      exportName: `${this.stackName}-SecretArn`,
    });

    new cdk.CfnOutput(this, 'SecretName', {
      value: this.secretsConstruct.secretName,
      description: `iRacing OAuth Secret Name for ${environment} environment`,
      exportName: `${this.stackName}-SecretName`,
    });

    // DynamoDB table outputs
    new cdk.CfnOutput(this, 'IRAuthTableName', {
      value: this.databaseConstruct.irAuthTable.tableName,
      description: `IR Auth DynamoDB table name for ${environment} environment`,
      exportName: `${this.stackName}-IRAuthTableName`,
    });

    new cdk.CfnOutput(this, 'IRCustidTableName', {
      value: this.databaseConstruct.irCustidTable.tableName,
      description: `IR Custid DynamoDB table name for ${environment} environment`,
      exportName: `${this.stackName}-IRCustidTableName`,
    });

    new cdk.CfnOutput(this, 'IRDriversTableName', {
      value: this.databaseConstruct.irDriversTable.tableName,
      description: `IR Drivers DynamoDB table name for ${environment} environment`,
      exportName: `${this.stackName}-IRDriversTableName`,
    });

    // Lambda function outputs
    new cdk.CfnOutput(this, 'IRAuthFunctionName', {
      value: this.lambdaConstruct.irAuthFunction.functionName,
      description: `IR Auth Lambda function name for ${environment} environment`,
      exportName: `${this.stackName}-IRAuthFunctionName`,
    });

    new cdk.CfnOutput(this, 'IRCustidFunctionName', {
      value: this.lambdaConstruct.irCustidFunction.functionName,
      description: `IR Custid Lambda function name for ${environment} environment`,
      exportName: `${this.stackName}-IRCustidFunctionName`,
    });

    new cdk.CfnOutput(this, 'IRDriversFunctionName', {
      value: this.lambdaConstruct.irDriversFunction.functionName,
      description: `IR Drivers Lambda function name for ${environment} environment`,
      exportName: `${this.stackName}-IRDriversFunctionName`,
    });

    // Environment-specific information
    new cdk.CfnOutput(this, 'Environment', {
      value: environment,
      description: 'Deployment environment',
      exportName: `${this.stackName}-Environment`,
    });

    new cdk.CfnOutput(this, 'Region', {
      value: this.region,
      description: 'AWS region',
      exportName: `${this.stackName}-Region`,
    });

    new cdk.CfnOutput(this, 'AccountId', {
      value: this.account,
      description: 'AWS account ID',
      exportName: `${this.stackName}-AccountId`,
    });
  }

  /**
   * Get all resource ARNs for cross-stack references
   */
  public getResourceArns(): { [key: string]: string } {
    return {
      secretArn: this.secretsConstruct.iracingSecret.secretArn,
      irAuthTableArn: this.databaseConstruct.irAuthTable.tableArn,
      irCustidTableArn: this.databaseConstruct.irCustidTable.tableArn,
      irDriversTableArn: this.databaseConstruct.irDriversTable.tableArn,
      irAuthFunctionArn: this.lambdaConstruct.irAuthFunction.functionArn,
      irCustidFunctionArn: this.lambdaConstruct.irCustidFunction.functionArn,
      irDriversFunctionArn: this.lambdaConstruct.irDriversFunction.functionArn,
      apiGatewayArn: this.apiGatewayConstruct.getApiArn(),
    };
  }

  /**
   * Get all resource names for external references
   */
  public getResourceNames(): { [key: string]: string } {
    return {
      secretName: this.secretsConstruct.secretName,
      irAuthTableName: this.databaseConstruct.irAuthTable.tableName,
      irCustidTableName: this.databaseConstruct.irCustidTable.tableName,
      irDriversTableName: this.databaseConstruct.irDriversTable.tableName,
      irAuthFunctionName: this.lambdaConstruct.irAuthFunction.functionName,
      irCustidFunctionName: this.lambdaConstruct.irCustidFunction.functionName,
      irDriversFunctionName: this.lambdaConstruct.irDriversFunction.functionName,
      apiGatewayId: this.apiGatewayConstruct.api.restApiId,
    };
  }
}
