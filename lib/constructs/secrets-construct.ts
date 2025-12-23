import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface SecretsConstructProps {
  readonly secretName?: string;
  readonly importExisting?: boolean;
}

export class SecretsConstruct extends Construct {
  public readonly iracingSecret: secretsmanager.ISecret;
  public readonly secretName: string;

  constructor(scope: Construct, id: string, props?: SecretsConstructProps) {
    super(scope, id);

    this.secretName = props?.secretName || 'iracing-oauth-credentials';

    if (props?.importExisting) {
      // Import existing secret by complete ARN to ensure proper IAM permissions
      // We need to construct the ARN pattern that includes the random suffix
      const region = cdk.Stack.of(this).region;
      const account = cdk.Stack.of(this).account;
      const secretArnPattern = `arn:aws:secretsmanager:${region}:${account}:secret:${this.secretName}-*`;
      
      this.iracingSecret = secretsmanager.Secret.fromSecretPartialArn(
        this,
        'IRacingOAuthSecret',
        secretArnPattern
      );
    } else {
      // Create new Secrets Manager secret for iRacing OAuth credentials
      this.iracingSecret = new secretsmanager.Secret(this, 'IRacingOAuthSecret', {
        secretName: this.secretName,
        description: 'iRacing OAuth 2.1 password_limited_flow credentials',
        secretObjectValue: {
          client_id: cdk.SecretValue.unsafePlainText(''),
          client_secret: cdk.SecretValue.unsafePlainText(''),
          username: cdk.SecretValue.unsafePlainText(''),
          password: cdk.SecretValue.unsafePlainText(''),
        },
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });

      // Add tags for better resource management (only for new secrets)
      cdk.Tags.of(this.iracingSecret).add('Component', 'Authentication');
      cdk.Tags.of(this.iracingSecret).add('Service', 'iRacing');
    }
  }
}