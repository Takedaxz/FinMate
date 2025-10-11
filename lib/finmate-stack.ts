import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export class FinMateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket for portfolio files and reports
    const portfolioBucket = new s3.Bucket(this, 'FinMatePortfolioBucket', {
      bucketName: `finmate-portfolios-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda execution role for tool functions
    const toolLambdaRole = new iam.Role(this, 'ToolLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant S3 access to tool role
    portfolioBucket.grantReadWrite(toolLambdaRole);

    // Lambda execution role for app function
    const appLambdaRole = new iam.Role(this, 'AppLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant S3 and Bedrock access to app role
    portfolioBucket.grantReadWrite(appLambdaRole);
    appLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:GetFoundationModel',
        'bedrock:ListFoundationModels',
        'bedrock-agent:InvokeAgent',
        'bedrock-agent-runtime:InvokeAgent',
      ],
      resources: ['*'],
    }));

    // Market Data Tool Lambda (Python with Yahoo Finance API - no dependencies)
    const marketDataLambda = new lambda.Function(this, 'MarketDataFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'market-data-python.handler',
      code: lambda.Code.fromAsset('lambda/python'),
      role: toolLambdaRole,
      environment: {
        BUCKET_NAME: portfolioBucket.bucketName,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });

    // Compute Metrics Tool Lambda
    const computeMetricsLambda = new lambda.Function(this, 'ComputeMetricsFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'compute-metrics.handler',
      code: lambda.Code.fromAsset('lambda'),
      role: toolLambdaRole,
      environment: {
        BUCKET_NAME: portfolioBucket.bucketName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Write Report Tool Lambda
    const writeReportLambda = new lambda.Function(this, 'WriteReportFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'write-report.handler',
      code: lambda.Code.fromAsset('lambda'),
      role: toolLambdaRole,
      environment: {
        BUCKET_NAME: portfolioBucket.bucketName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Note: Bedrock Agent functionality integrated directly into main app Lambda

    // Main Application Lambda
    const appLambda = new lambda.Function(this, 'FinMateAppFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'app.handler',
      code: lambda.Code.fromAsset('lambda'),
      role: appLambdaRole,
      environment: {
        BUCKET_NAME: portfolioBucket.bucketName,
        MARKET_DATA_FUNCTION: marketDataLambda.functionName,
        COMPUTE_METRICS_FUNCTION: computeMetricsLambda.functionName,
        WRITE_REPORT_FUNCTION: writeReportLambda.functionName,
      },
      timeout: cdk.Duration.minutes(15),
    });

    // Grant Lambda invoke permissions
    marketDataLambda.grantInvoke(appLambda);
    computeMetricsLambda.grantInvoke(appLambda);
    writeReportLambda.grantInvoke(appLambda);

    // API Gateway
    const api = new apigateway.RestApi(this, 'FinMateApi', {
      restApiName: 'FinMate Portfolio Advisor API',
      description: 'API for FinMate AI Portfolio Advisor',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // API Gateway Integration
    const appIntegration = new apigateway.LambdaIntegration(appLambda);

    // API Routes
    const portfolio = api.root.addResource('portfolio');
    portfolio.addMethod('POST', appIntegration); // Upload portfolio
    portfolio.addMethod('GET', appIntegration);  // Get portfolio

    const analyze = portfolio.addResource('analyze');
    analyze.addMethod('POST', appIntegration);

    const report = api.root.addResource('report');
    report.addMethod('GET', appIntegration);

    const simulate = api.root.addResource('simulate');
    const rebalance = simulate.addResource('rebalance');
    rebalance.addMethod('POST', appIntegration);

    // Note: Bedrock Agent endpoint removed to avoid circular dependency
    // Agent functionality is integrated directly into the main app Lambda

    // EventBridge rule for Daily Check
    const dailyCheckRule = new events.Rule(this, 'DailyCheckRule', {
      schedule: events.Schedule.cron({
        hour: '9',
        minute: '0',
      }),
      description: 'Trigger daily portfolio check',
    });

    dailyCheckRule.addTarget(new targets.LambdaFunction(appLambda, {
      event: events.RuleTargetInput.fromObject({
        source: 'daily-check',
        action: 'analyze',
      }),
    }));

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'FinMate API Gateway URL',
    });

    new cdk.CfnOutput(this, 'PortfolioBucket', {
      value: portfolioBucket.bucketName,
      description: 'S3 Bucket for portfolio storage',
    });

    // Web Hosting Infrastructure
    // S3 Bucket for web hosting
    const webBucket = new s3.Bucket(this, 'WebHostingBucket', {
      bucketName: `finmate-web-${this.account}-${this.region}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html', // SPA fallback
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront Distribution for web hosting
    const distribution = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'WebBucketName', {
      value: webBucket.bucketName,
      description: 'S3 Bucket for web hosting',
    });

    new cdk.CfnOutput(this, 'WebDistributionUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront Distribution URL for web app',
    });

    new cdk.CfnOutput(this, 'WebDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });
  }
}
