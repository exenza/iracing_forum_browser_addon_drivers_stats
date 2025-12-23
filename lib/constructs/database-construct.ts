import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DatabaseConstructProps {
  readonly tableNamePrefix?: string;
}

export class DatabaseConstruct extends Construct {
  public readonly irAuthTable: dynamodb.Table;
  public readonly irCustidTable: dynamodb.Table;
  public readonly irDriversTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: DatabaseConstructProps) {
    super(scope, id);

    const prefix = props?.tableNamePrefix || '';

    // ir_auth table for storing OAuth tokens
    this.irAuthTable = new dynamodb.Table(this, 'IRAuthTable', {
      tableName: `${prefix}ir_auth`,
      partitionKey: { 
        name: 'username', 
        type: dynamodb.AttributeType.STRING 
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ir_custid table for customer ID lookups
    this.irCustidTable = new dynamodb.Table(this, 'IRCustidTable', {
      tableName: `${prefix}ir_custid`,
      partitionKey: { 
        name: 'name', 
        type: dynamodb.AttributeType.STRING 
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ir_drivers table for driver profiles with TTL
    this.irDriversTable = new dynamodb.Table(this, 'IRDriversTable', {
      tableName: `${prefix}ir_drivers`,
      partitionKey: { 
        name: 'name', 
        type: dynamodb.AttributeType.STRING 
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Add tags for better resource management
    const tables = [this.irAuthTable, this.irCustidTable, this.irDriversTable];
    tables.forEach(table => {
      cdk.Tags.of(table).add('Component', 'Database');
      cdk.Tags.of(table).add('Service', 'iRacing');
    });
  }
}