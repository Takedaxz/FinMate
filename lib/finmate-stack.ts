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
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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

    // DynamoDB Table for analysis job tracking
    const analysisJobsTable = new dynamodb.Table(this, 'AnalysisJobsTable', {
      tableName: `finmate-analysis-jobs-${this.account}-${this.region}`,
      partitionKey: { name: 'job_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl', // Auto-delete old jobs after 7 days
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

    // Python Dependencies Layer for Market Data
    const marketDataLayer = new lambda.LayerVersion(this, 'MarketDataLayer', {
      code: lambda.Code.fromAsset('lambda-layer'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
      description: 'Python dependencies for market data Lambda (yfinance, pandas, numpy, etc.)',
    });

    // Market Data Tool Lambda (Python with Yahoo Finance API)
    const marketDataLambda = new lambda.Function(this, 'MarketDataFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'market-data-python.handler',
      code: lambda.Code.fromAsset('lambda'),
      layers: [marketDataLayer],
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

    // ============================================================
    // BEDROCK AGENT WITH AGENTCORE (TEMPORARILY COMMENTED OUT)
    // ============================================================
    // TODO: Deploy agent manually using create-agent-cli.sh to avoid circular dependency

    // Agent IAM Role
    // const agentRole = new iam.Role(this, 'BedrockAgentRole', {
    //   assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
    //   description: 'IAM role for FinMate Bedrock Agent',
    // });

    // Grant agent access to invoke Lambda
    // agentRole.addToPolicy(new iam.PolicyStatement({
    //   effect: iam.Effect.ALLOW,
    //   actions: ['lambda:InvokeFunction'],
    //   resources: ['*'], // Will be restricted to specific Lambdas below
    // }));

    // Tool Orchestrator Lambda (routes agent calls to existing tools)
    const agentToolsLambda = new lambda.Function(this, 'AgentToolsFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'agent-tools.handler',
      code: lambda.Code.fromAsset('lambda'),
      role: toolLambdaRole,
      environment: {
        MARKET_DATA_FUNCTION: marketDataLambda.functionName,
        COMPUTE_METRICS_FUNCTION: computeMetricsLambda.functionName,
        WRITE_REPORT_FUNCTION: writeReportLambda.functionName,
      },
      timeout: cdk.Duration.minutes(5),
    });

    // Grant tool orchestrator permission to invoke existing tools
    marketDataLambda.grantInvoke(agentToolsLambda);
    computeMetricsLambda.grantInvoke(agentToolsLambda);
    writeReportLambda.grantInvoke(agentToolsLambda);

    // Grant Bedrock Agent permission to invoke tool orchestrator
    agentToolsLambda.grantInvoke(new iam.ServicePrincipal('bedrock.amazonaws.com'));

    // OpenAPI Schema for Agent Action Group
    const actionGroupSchema = {
      openapi: '3.0.0',
      info: {
        title: 'FinMate Portfolio Analysis Tools API',
        version: '1.0.0',
        description: 'Tools for portfolio analysis, market data, and reporting',
      },
      paths: {
        '/get_market_data': {
          post: {
            summary: 'Fetch real-time market data for tickers',
            description: 'Retrieves current prices, sectors, and beta values for stock tickers',
            operationId: 'getMarketData',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      tickers: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of stock ticker symbols (e.g., ["AAPL", "MSFT"])',
                      },
                      portfolio_id: {
                        type: 'string',
                        description: 'Optional portfolio ID for caching',
                      },
                    },
                    required: ['tickers'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Market data retrieved successfully',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        quotes: { type: 'object' },
                        sectors: { type: 'object' },
                        betas: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/compute_metrics': {
          post: {
            summary: 'Calculate portfolio metrics and risk analysis',
            description: 'Computes weights, P&L, sector exposure, beta, and risk flags',
            operationId: 'computeMetrics',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      portfolio: {
                        type: 'object',
                        description: 'Portfolio object with positions and settings',
                      },
                      market_data: {
                        type: 'object',
                        description: 'Market data from get_market_data tool',
                      },
                    },
                    required: ['portfolio', 'market_data'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Metrics computed successfully',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        total_value: { type: 'number' },
                        total_pnl: { type: 'number' },
                        portfolio_beta: { type: 'number' },
                        risk_flags: { type: 'array' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/write_report': {
          post: {
            summary: 'Generate portfolio analysis report',
            description: 'Creates HTML/Markdown report and saves to S3',
            operationId: 'writeReport',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      portfolio_metrics: {
                        type: 'object',
                        description: 'Metrics from compute_metrics tool',
                      },
                      analysis_summary: {
                        type: 'string',
                        description: 'Summary text for report',
                      },
                      recommendations: {
                        type: 'array',
                        description: 'Array of recommendation objects',
                      },
                      user_id: {
                        type: 'string',
                        description: 'User ID for report storage',
                      },
                    },
                    required: ['portfolio_metrics'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Report generated successfully',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        report_url: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    // ============================================================
    // BEDROCK AGENT CREATION (MANUAL DEPLOYMENT)
    // ============================================================
    // The Bedrock Agent will be created manually using create-agent-cli.sh
    // to avoid circular dependency issues in CDK
    // 
    // Agent will be created with:
    // - Agent Name: finmate-portfolio-advisor
    // - Foundation Model: anthropic.claude-3-sonnet-20240229-v1:0
    // - Action Group: portfolio-tools (linked to agentToolsLambda)
    // - Alias: live

    // Main Application Lambda
    // Note: Agent IDs are NOT added as environment variables to avoid circular dependency
    // Instead, they will be retrieved from CloudFormation exports or passed via API
    const appLambda = new lambda.Function(this, 'FinMateAppFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'app.handler',
      code: lambda.Code.fromAsset('lambda'),
      role: appLambdaRole,
      environment: {
        BUCKET_NAME: portfolioBucket.bucketName,
        ANALYSIS_JOBS_TABLE: analysisJobsTable.tableName,
        MARKET_DATA_FUNCTION: marketDataLambda.functionName,
        COMPUTE_METRICS_FUNCTION: computeMetricsLambda.functionName,
        WRITE_REPORT_FUNCTION: writeReportLambda.functionName,
        // BEDROCK_AGENT_ID and BEDROCK_AGENT_ALIAS_ID will be set manually after deployment
        // or retrieved from CloudFormation exports: FinMateBedrockAgentId, FinMateBedrockAgentAliasId
      },
      timeout: cdk.Duration.minutes(15),
    });

    // Grant Lambda invoke permissions
    marketDataLambda.grantInvoke(appLambda);
    computeMetricsLambda.grantInvoke(appLambda);
    writeReportLambda.grantInvoke(appLambda);
    
    // Grant DynamoDB access
    analysisJobsTable.grantReadWriteData(appLambda);

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

    // Add CORS headers to Gateway Responses (for timeouts and errors)
    const corsHeaders = {
      'Access-Control-Allow-Origin': "'*'",
      'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key'",
      'Access-Control-Allow-Methods': "'GET,POST,OPTIONS'",
    };

    api.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: corsHeaders,
    });

    api.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: corsHeaders,
    });

    api.addGatewayResponse('Timeout', {
      type: apigateway.ResponseType.INTEGRATION_TIMEOUT,
      responseHeaders: corsHeaders,
    });

    // API Gateway Integration
    const appIntegration = new apigateway.LambdaIntegration(appLambda);

    // API Routes
    const portfolio = api.root.addResource('portfolio');
    portfolio.addMethod('POST', appIntegration); // Upload portfolio
    portfolio.addMethod('GET', appIntegration);  // Get portfolio

    const analyze = portfolio.addResource('analyze');
    analyze.addMethod('POST', appIntegration); // Start analysis (async)
    
    const analyzeStatus = analyze.addResource('{job_id}');
    analyzeStatus.addMethod('GET', appIntegration); // Check analysis status

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

    // CloudFormation Outputs for Bedrock Agent (commented out for manual deployment)
    // new cdk.CfnOutput(this, 'BedrockAgentId', {
    //   value: bedrockAgent.attrAgentId,
    //   description: 'Bedrock Agent ID - visible in AWS Console',
    //   exportName: 'FinMateBedrockAgentId',
    // });

    // new cdk.CfnOutput(this, 'BedrockAgentAliasId', {
    //   value: agentAlias.attrAgentAliasId,
    //   description: 'Bedrock Agent Alias ID',
    //   exportName: 'FinMateBedrockAgentAliasId',
    // });

    // new cdk.CfnOutput(this, 'BedrockAgentArn', {
    //   value: bedrockAgent.attrAgentArn,
    //   description: 'Bedrock Agent ARN',
    // });

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
