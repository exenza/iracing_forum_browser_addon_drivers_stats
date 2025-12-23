import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface ApiGatewayConstructProps {
  readonly irAuthFunction: lambda.Function;
  readonly irCustidFunction: lambda.Function;
  readonly irDriversFunction: lambda.Function;
  readonly apiName: string;
  readonly environment?: string;
}

export class ApiGatewayConstruct extends Construct {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayConstructProps) {
    super(scope, id);

    const environment = props.environment || 'dev';

    // Create REST API
    this.api = new apigateway.RestApi(this, 'IRacingApi', {
      restApiName: props.apiName,
      description: 'API Gateway for iRacing Forum Browser Addon Drivers Stats Lambda functions',
      deployOptions: {
        stageName: environment,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Amz-User-Agent',
        ],
      },
    });

    // Create Lambda integrations
    const authIntegration = new apigateway.LambdaIntegration(props.irAuthFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
      proxy: true,
    });

    const custidIntegration = new apigateway.LambdaIntegration(props.irCustidFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
      proxy: true,
    });

    const driversIntegration = new apigateway.LambdaIntegration(props.irDriversFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
      proxy: true,
    });

    // Create API resources and methods
    
    // /auth endpoint - POST for OAuth authentication
    const authResource = this.api.root.addResource('auth');
    authResource.addMethod('POST', authIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
          },
        },
        {
          statusCode: '400',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '401',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '429',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Retry-After': true,
          },
        },
        {
          statusCode: '500',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '503',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
      ],
    });

    // /custid endpoint - GET for customer ID lookup
    const custidResource = this.api.root.addResource('custid');
    custidResource.addMethod('GET', custidIntegration, {
      requestParameters: {
        'method.request.querystring.name': false, // Optional query parameter
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
          },
        },
        {
          statusCode: '400',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '401',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '404',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '500',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '502',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '503',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
      ],
    });

    // /drivers endpoint - GET for driver profile lookup
    const driversResource = this.api.root.addResource('drivers');
    driversResource.addMethod('GET', driversIntegration, {
      requestParameters: {
        'method.request.querystring.names': false, // Optional query parameter for multiple names
        'method.request.querystring.name': false,  // Optional query parameter for single name
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
          },
        },
        {
          statusCode: '400',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '401',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '404',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '500',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '502',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
        {
          statusCode: '503',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
      ],
    });

    // Add comprehensive tags for better resource management
    this.addResourceTags(environment);
  }

  private addResourceTags(environment: string): void {
    cdk.Tags.of(this.api).add('Component', 'API Gateway');
    cdk.Tags.of(this.api).add('Service', 'iRacing-Forum-Browser-Addon-Drivers-Stats');
    cdk.Tags.of(this.api).add('Environment', environment);
    cdk.Tags.of(this.api).add('ManagedBy', 'CDK');
    cdk.Tags.of(this.api).add('Project', 'iRacing-Forum-Browser-Addon-Drivers-Stats');
  }

  /**
   * Get the API Gateway URL for external access
   */
  public getApiUrl(): string {
    return this.api.url;
  }

  /**
   * Get the API Gateway ARN for use in other constructs
   */
  public getApiArn(): string {
    return this.api.arnForExecuteApi();
  }
}