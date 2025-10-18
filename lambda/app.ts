import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import * as csv from 'csv-parser';
import { Readable } from 'stream';
import { getBedrockRateLimiter, retryWithBackoff } from './rate-limiter';

const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});
const bedrockClient = new BedrockRuntimeClient({});
const bedrockAgentClient = new BedrockAgentRuntimeClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Helper function to add CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

interface PortfolioPosition {
  ticker: string;
  units: number;
  cost_basis: number;
  acquisition_date?: string;
}

interface Portfolio {
  user_id: string;
  as_of: string;
  positions: PortfolioPosition[];
  cash_ccy: string;
  settings: {
    risk: string;
    max_single_name_weight: number;
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('FinMate App Lambda Event:', JSON.stringify(event, null, 2));

  try {
    // Check if this is an async invocation for background analysis
    if ((event as any).action === 'run_analysis') {
      return await handlePortfolioAnalysis(event as any);
    }

    const httpMethod = event.httpMethod;
    const path = event.path;
    const body = event.body ? JSON.parse(event.body) : {};

    // Handle CORS preflight requests
    if (httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: '',
      };
    }

    // Handle different API endpoints
    if (httpMethod === 'POST' && path === '/portfolio') {
      return await handlePortfolioUpload(event);
    } else if (httpMethod === 'GET' && path === '/portfolio') {
      return await handleGetPortfolio(event);
    } else if (httpMethod === 'POST' && path === '/portfolio/analyze') {
      return await handlePortfolioAnalysisAsync(body);
    } else if (httpMethod === 'GET' && path.startsWith('/portfolio/analyze/')) {
      const jobId = event.pathParameters?.job_id || path.split('/').pop();
      return await handleGetAnalysisStatus(jobId!);
    } else if (httpMethod === 'GET' && path === '/report') {
      return await handleGetReport(event);
    } else if (httpMethod === 'POST' && path === '/simulate/rebalance') {
      return await handleSimulateRebalance(body);
    } else if ((event as any).source === 'daily-check') {
      return await handleDailyCheck(body);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  } catch (error) {
    console.error('Error in FinMate app handler:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

async function handlePortfolioUpload(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const contentType = event.headers['content-type'] || '';
    let portfolio: Portfolio;

    if (contentType.includes('multipart/form-data')) {
      // Handle CSV upload
      portfolio = await parseCsvPortfolio(event.body || '');
    } else {
      // Handle JSON upload
      portfolio = JSON.parse(event.body || '{}');
    }

    // Validate portfolio
    if (!portfolio.positions || !Array.isArray(portfolio.positions)) {
      throw new Error('Invalid portfolio format');
    }

    // Generate portfolio ID and save to S3
    const portfolioId = uuidv4();
    portfolio.user_id = portfolio.user_id || 'demo-user';
    portfolio.as_of = new Date().toISOString();
    portfolio.settings = portfolio.settings || {
      risk: 'medium',
      max_single_name_weight: 0.25,
    };

    await savePortfolio(portfolioId, portfolio);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        portfolio_id: portfolioId,
        message: 'Portfolio uploaded successfully',
        detected_tickers: portfolio.positions.map(p => p.ticker),
        total_positions: portfolio.positions.length,
      }),
    };
  } catch (error) {
    console.error('Error uploading portfolio:', error);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to upload portfolio',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

async function handleGetPortfolio(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const portfolioId = event.queryStringParameters?.portfolio_id;
    if (!portfolioId) {
      throw new Error('Portfolio ID is required');
    }

    const portfolio = await getPortfolio(portfolioId);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(portfolio),
    };
  } catch (error) {
    console.error('Error getting portfolio:', error);
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Portfolio not found',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// New async handler - returns immediately with job_id
async function handlePortfolioAnalysisAsync(body: any): Promise<APIGatewayProxyResult> {
  try {
    const { portfolio_id, risk_prefs } = body;
    if (!portfolio_id) {
      throw new Error('Portfolio ID is required');
    }

    // Generate job ID
    const jobId = uuidv4();
    
    // Store initial job status in DynamoDB
    await dynamoClient.send(new PutCommand({
      TableName: process.env.ANALYSIS_JOBS_TABLE!,
      Item: {
        job_id: jobId,
        portfolio_id,
        status: 'processing',
        created_at: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days TTL
      },
    }));

    // Invoke Lambda asynchronously to run analysis in background
    await lambdaClient.send(new InvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME!,
      InvocationType: InvocationType.Event, // Async invocation
      Payload: JSON.stringify({
        action: 'run_analysis',
        job_id: jobId,
        portfolio_id,
        risk_prefs,
      }),
    }));

    return {
      statusCode: 202, // Accepted
      headers: corsHeaders,
      body: JSON.stringify({
        job_id: jobId,
        status: 'processing',
        message: 'Analysis started. Use the job_id to check status.',
      }),
    };
  } catch (error) {
    console.error('Error starting portfolio analysis:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to start analysis',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Check analysis job status
async function handleGetAnalysisStatus(jobId: string): Promise<APIGatewayProxyResult> {
  try {
    const result = await dynamoClient.send(new GetCommand({
      TableName: process.env.ANALYSIS_JOBS_TABLE!,
      Key: { job_id: jobId },
    }));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Job not found' }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(result.Item),
    };
  } catch (error) {
    console.error('Error getting analysis status:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to get status',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Background analysis runner (called asynchronously)
async function handlePortfolioAnalysis(body: any): Promise<APIGatewayProxyResult> {
  const { job_id, portfolio_id, risk_prefs } = body;
  
  try {
    // Update status to running
    await dynamoClient.send(new UpdateCommand({
      TableName: process.env.ANALYSIS_JOBS_TABLE!,
      Key: { job_id },
      UpdateExpression: 'SET #status = :status, started_at = :started',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'running',
        ':started': new Date().toISOString(),
      },
    }));

    // Get portfolio
    const portfolio = await getPortfolio(portfolio_id);
    
    // Update risk preferences if provided
    if (risk_prefs) {
      portfolio.settings.risk = risk_prefs.risk || portfolio.settings.risk;
      portfolio.settings.max_single_name_weight = risk_prefs.max_single_name_weight || portfolio.settings.max_single_name_weight;
    }

    // Use Bedrock Agent to autonomously analyze the portfolio
    console.log('Invoking Bedrock Agent for autonomous portfolio analysis...');
    const analysis = await invokeBedrockAgent(portfolio, portfolio_id);

    // Update status to completed with results
    await dynamoClient.send(new UpdateCommand({
      TableName: process.env.ANALYSIS_JOBS_TABLE!,
      Key: { job_id },
      UpdateExpression: 'SET #status = :status, completed_at = :completed, summary = :summary, suggestions = :suggestions, report_url = :report, analysis_summary = :analysis',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'completed',
        ':completed': new Date().toISOString(),
        ':summary': analysis.summary || 'Analysis completed',
        ':suggestions': analysis.recommendations || [],
        ':report': analysis.report_url || '',
        ':analysis': analysis.analysis_text || '',
      },
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Error analyzing portfolio:', error);
    
    // Update status to failed
    await dynamoClient.send(new UpdateCommand({
      TableName: process.env.ANALYSIS_JOBS_TABLE!,
      Key: { job_id },
      UpdateExpression: 'SET #status = :status, error_message = :error, failed_at = :failed',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'failed',
        ':error': error instanceof Error ? error.message : 'Unknown error',
        ':failed': new Date().toISOString(),
      },
    }));

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to analyze portfolio',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

async function handleGetReport(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const userId = event.queryStringParameters?.user_id;
    if (!userId) {
      throw new Error('User ID is required');
    }

    // For simplicity, return the latest report URL
    // In production, you'd query S3 for the most recent report
    const reportUrl = `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/reports/${userId}/latest/summary.html`;
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        report_url: reportUrl,
        user_id: userId,
      }),
    };
  } catch (error) {
    console.error('Error getting report:', error);
    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Report not found',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

async function handleSimulateRebalance(body: any): Promise<APIGatewayProxyResult> {
  try {
    const { target_weights, portfolio_id } = body;
    if (!target_weights || !portfolio_id) {
      throw new Error('Target weights and portfolio ID are required');
    }

    // Get current portfolio
    const portfolio = await getPortfolio(portfolio_id);
    
    // This is a simplified simulation - in production you'd do more complex calculations
    const simulation = {
      before: portfolio.positions.map(p => ({
        ticker: p.ticker,
        current_weight: 0, // Would calculate from current market data
      })),
      after: Object.entries(target_weights).map(([ticker, weight]) => ({
        ticker,
        target_weight: weight,
      })),
      delta: 'Simulation completed - no actual trades executed',
      note: 'This is a simulation only. No actual trades were executed.',
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(simulation),
    };
  } catch (error) {
    console.error('Error simulating rebalance:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to simulate rebalance',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}


async function handleDailyCheck(body: any): Promise<APIGatewayProxyResult> {
  try {
    console.log('Running daily check...');
    
    // For demo purposes, analyze a sample portfolio
    // In production, you'd iterate through all user portfolios
    const samplePortfolioId = 'demo-portfolio';
    
    // Run the same analysis as manual analysis
    const analysisResult = await handlePortfolioAnalysis({
      portfolio_id: samplePortfolioId,
      risk_prefs: { risk: 'medium' },
    });

    console.log('Daily check completed successfully');
    return analysisResult;
  } catch (error) {
    console.error('Error in daily check:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Daily check failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

async function invokeBedrockAgent(portfolio: Portfolio, portfolioId: string): Promise<any> {
  console.log('Invoking Bedrock Agent with AgentCore...');
  
  // Get agent IDs from environment or CloudFormation exports
  const agentId = process.env.BEDROCK_AGENT_ID;
  const agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID;
  
  if (!agentId || !agentAliasId) {
    console.warn('Bedrock Agent environment variables not set, using fallback analysis');
    console.log('To use the agent, set BEDROCK_AGENT_ID and BEDROCK_AGENT_ALIAS_ID environment variables');
    console.log('Agent IDs are available in CloudFormation outputs after deployment');
    return await fallbackDirectAnalysis(portfolio, portfolioId);
  }

  try {
    // Create comprehensive input for the agent
    const agentInput = `Please analyze this portfolio and provide recommendations:

Portfolio ID: ${portfolioId}
User Risk Preference: ${portfolio.settings.risk}
Number of Positions: ${portfolio.positions.length}

Positions:
${portfolio.positions.map(p => `- ${p.ticker}: ${p.units} shares at $${p.cost_basis} cost basis`).join('\n')}

Please use your tools to:
1. Get current market data for all tickers
2. Compute portfolio metrics including P&L, beta, sector exposure, and risk flags  
3. Analyze the results and provide 2-3 specific recommendations
4. Generate a professional report

Focus on diversification, risk management, and optimization opportunities based on ${portfolio.settings.risk} risk tolerance.`;

    console.log('Agent Input:', agentInput);
    console.log('Agent ID:', agentId);
    console.log('Agent Alias:', agentAliasId);

    // Get rate limiter and check/wait if needed
    const rateLimiter = getBedrockRateLimiter();
    const stats = rateLimiter.getStats();
    console.log('Bedrock Rate Limiter Stats:', JSON.stringify(stats));
    
    // Wait if we're at quota
    await rateLimiter.checkAndWait();

    const command = new InvokeAgentCommand({
      agentId: agentId,
      agentAliasId: agentAliasId,
      sessionId: `session-${portfolioId}-${Date.now()}`, // Unique session per analysis
      inputText: agentInput,
    });

    // Invoke with retry logic for throttling
    const response = await retryWithBackoff(
      () => bedrockAgentClient.send(command),
      3, // max retries
      2000 // base delay 2s
    );
    
    // Parse streaming response
    let fullResponse = '';
    let citations: any[] = [];
    let traceData: any[] = [];
    
    if (response.completion) {
      for await (const event of response.completion) {
        if (event.chunk) {
          const chunk = new TextDecoder().decode(event.chunk.bytes);
          fullResponse += chunk;
        }
        if (event.trace) {
          traceData.push(event.trace);
          console.log('Agent Trace:', JSON.stringify(event.trace, null, 2));
        }
      }
    }

    console.log('Agent Full Response:', fullResponse);
    console.log('Agent executed autonomously with tool calls visible in traces');

    // Parse agent response to extract analysis
    const analysis = parseAgentResponse(fullResponse, traceData);
    
    return analysis;
    
  } catch (error) {
    console.error('Bedrock Agent invocation failed:', error);
    // Fallback to direct tool calls if agent fails
    return await fallbackDirectAnalysis(portfolio, portfolioId);
  }
}

function parseAgentResponse(responseText: string, traces: any[]): any {
  console.log('Parsing agent response...');
  
  // Try to extract structured data from response
  let summary: any = {};
  let recommendations: any[] = [];
  let reportUrl: string | undefined;

  // Extract metrics from agent's response
  const totalValueMatch = responseText.match(/Total Value[:\s]+\$?([\d,]+\.?\d*)/i);
  const pnlMatch = responseText.match(/P&L[:\s]+([+-]?\$?[\d,]+\.?\d*)/i);
  const pnlPercentMatch = responseText.match(/([+-]?[\d.]+)%/);
  const betaMatch = responseText.match(/[Bb]eta[:\s]+([\d.]+)/);

  summary = {
    total_value: totalValueMatch ? parseFloat(totalValueMatch[1].replace(/,/g, '')) : 0,
    total_pnl: pnlMatch ? parseFloat(pnlMatch[1].replace(/[$,]/g, '')) : 0,
    total_pnl_percent: pnlPercentMatch ? parseFloat(pnlPercentMatch[1]) : 0,
    portfolio_beta: betaMatch ? parseFloat(betaMatch[1]) : 1.0,
    risk_flags_count: (responseText.match(/risk flag/gi) || []).length,
  };

  // Extract recommendations from agent response
  const recommendationMatches = responseText.match(/\d+\.\s+(.+?)(?=\n\d+\.|\n\n|$)/g);
  if (recommendationMatches) {
    recommendations = recommendationMatches.slice(0, 3).map((rec, idx) => {
      const cleanRec = rec.replace(/^\d+\.\s+/, '').trim();
      return {
        action: cleanRec.split(/[.!?]/)[0],
        rationale: cleanRec,
        impact: 'See full analysis for details',
        priority: idx === 0 ? 'high' : 'medium'
      };
    });
  }

  // Extract report URL if mentioned
  const urlMatch = responseText.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    reportUrl = urlMatch[0];
  }

  return {
    summary,
    recommendations: recommendations.length > 0 ? recommendations : [
      {
        action: 'Review portfolio diversification',
        rationale: 'Agent analysis completed - see full response for details',
        impact: 'Improved risk-adjusted returns',
        priority: 'medium'
      }
    ],
    report_url: reportUrl,
    analysis_text: responseText,
    agent_traces: traces.length,
  };
}

async function fallbackDirectAnalysis(portfolio: Portfolio, portfolioId: string): Promise<any> {
  console.log('Using fallback direct tool analysis...');
  
  try {
    // Manually call tools since agent failed
    const marketDataResponse = await invokeLambda(process.env.MARKET_DATA_FUNCTION!, {
      tickers: portfolio.positions.map(p => p.ticker),
      portfolio_id: portfolioId,
    });
    const marketDataParsed = JSON.parse(marketDataResponse);
    const marketData = marketDataParsed.body ? JSON.parse(marketDataParsed.body) : marketDataParsed;

    const metricsResponse = await invokeLambda(process.env.COMPUTE_METRICS_FUNCTION!, {
      portfolio,
      market_data: marketData,
    });
    const metricsResponseParsed = JSON.parse(metricsResponse);
    const portfolioMetrics = metricsResponseParsed.body ? JSON.parse(metricsResponseParsed.body) : metricsResponseParsed;

    return {
      summary: {
        total_value: portfolioMetrics.total_value,
        total_pnl: portfolioMetrics.total_pnl,
        total_pnl_percent: portfolioMetrics.total_pnl_percent,
        portfolio_beta: portfolioMetrics.portfolio_beta,
        risk_flags_count: portfolioMetrics.risk_flags.length,
      },
      recommendations: generateBasicRecommendations(portfolioMetrics),
      report_url: undefined,
      analysis_text: `Fallback analysis: Portfolio has ${portfolioMetrics.positions.length} positions with total value $${portfolioMetrics.total_value.toLocaleString()}. This is not financial advice.`,
    };
  } catch (error) {
    console.error('Fallback analysis also failed:', error);
    throw error;
  }
}

function generateBasicRecommendations(metrics: any): any[] {
  const recommendations = [];
  
  if (metrics.risk_flags && metrics.risk_flags.length > 0) {
    recommendations.push({
      action: 'Address risk flags',
      rationale: `Portfolio has ${metrics.risk_flags.length} risk flags: ${metrics.risk_flags[0]}`,
      impact: 'Reduces portfolio risk',
      priority: 'high'
    });
  }
  
  if (metrics.portfolio_beta > 1.3) {
    recommendations.push({
      action: 'Consider adding defensive positions',
      rationale: `Portfolio beta of ${metrics.portfolio_beta.toFixed(2)} indicates higher volatility`,
      impact: 'Reduces volatility',
      priority: 'medium'
    });
  }
  
  if (recommendations.length === 0) {
    recommendations.push({
      action: 'Monitor and maintain current allocation',
      rationale: 'Portfolio metrics are within acceptable ranges',
      impact: 'Continue balanced approach',
      priority: 'low'
    });
  }
  
  return recommendations;
}

async function performIntegratedAgentAnalysis(portfolio: Portfolio, metrics: any, marketData: any): Promise<any> {
  console.log('Performing integrated Bedrock AgentCore analysis...');

  try {
    // Create a comprehensive prompt for the AI agent
    const agentPrompt = `You are a sophisticated AI financial advisor agent with access to portfolio analysis tools. 

PORTFOLIO CONTEXT:
- Total Value: $${metrics.total_value?.toLocaleString() || 'N/A'}
- Total P&L: ${metrics.total_pnl >= 0 ? '+' : ''}$${metrics.total_pnl?.toLocaleString() || 'N/A'} (${metrics.total_pnl_percent?.toFixed(2) || 'N/A'}%)
- Portfolio Beta: ${metrics.portfolio_beta?.toFixed(2) || 'N/A'}
- Risk Preference: ${portfolio.settings?.risk || 'medium'}
- Sector Exposure: ${JSON.stringify(metrics.sector_exposure || {}, null, 2)}
- Top Concentrations: ${JSON.stringify(metrics.top_concentrations || [], null, 2)}
- Risk Flags: ${metrics.risk_flags?.length > 0 ? metrics.risk_flags.join(', ') : 'None'}

CURRENT POSITIONS:
${portfolio.positions?.map((p: any) => 
  `- ${p.ticker}: ${p.units} shares @ $${p.cost_basis} (Current: $${marketData[p.ticker]?.price || 'N/A'})`
).join('\n') || 'No positions'}

AGENT CAPABILITIES:
1. Portfolio Risk Assessment
2. Diversification Analysis  
3. Performance Optimization
4. Market Condition Analysis
5. Personalized Recommendations

Please provide a comprehensive analysis including:
1. Risk assessment and portfolio health
2. Diversification analysis
3. Performance insights
4. Specific actionable recommendations
5. Market outlook considerations

Format as JSON:
{
  "summary": "Brief portfolio summary with key insights",
  "recommendations": [
    {
      "action": "Specific action to take",
      "rationale": "Why this is recommended",
      "impact": "Expected outcome",
      "priority": "high/medium/low"
    }
  ],
  "agentMetadata": {
    "model": "arn:aws:bedrock:ap-southeast-1:417447013956:inference-profile/apac.anthropic.claude-3-5-sonnet-20241022-v2:0",
    "reasoning": "AI agent performed multi-step analysis including risk assessment, diversification analysis, and personalized recommendations",
    "capabilities": ["Risk Assessment", "Diversification Analysis", "Performance Optimization", "Market Analysis"]
  }
}`;

    // Use Bedrock Claude for agent reasoning
    const bedrockResponse = await bedrockClient.send(new InvokeModelCommand({
      modelId: 'arn:aws:bedrock:ap-southeast-1:417447013956:inference-profile/apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 3000,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: agentPrompt
          }
        ]
      })
    }));

    // Parse the response
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const agentContent = responseBody.content[0].text;
    
    console.log('Bedrock Agent Response:', agentContent);

    // Parse the JSON response
    let analysis;
    try {
      const jsonMatch = agentContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in agent response');
      }
    } catch (parseError) {
      console.log('Failed to parse agent response, using structured fallback');
      analysis = createStructuredAgentAnalysis(portfolio, metrics, marketData);
    }

    // Ensure we have the required structure
    if (!analysis.summary || !analysis.recommendations) {
      console.log('Agent response missing required fields, using fallback');
      analysis = createStructuredAgentAnalysis(portfolio, metrics, marketData);
    }

    return analysis;

  } catch (error) {
    console.error('Integrated AgentCore analysis failed:', error);
    return createStructuredAgentAnalysis(portfolio, metrics, marketData);
  }
}

function createStructuredAgentAnalysis(portfolio: Portfolio, metrics: any, marketData: any): any {
  console.log('Creating structured agent fallback analysis...');
  
  const riskFlags = metrics.risk_flags || [];
  const sectorExposure = metrics.sector_exposure || {};
  const topConcentrations = metrics.top_concentrations || [];
  
  // Calculate diversification score
  const sectorCount = Object.keys(sectorExposure).length;
  const maxSectorWeight = Math.max(...Object.values(sectorExposure) as number[]);
  const maxPositionWeight = topConcentrations[0]?.weight || 0;
  
  let diversificationScore = 10;
  if (maxSectorWeight > 50) diversificationScore -= 3;
  if (maxPositionWeight > 25) diversificationScore -= 2;
  if (sectorCount < 3) diversificationScore -= 2;
  if (riskFlags.length > 2) diversificationScore -= 3;
  
  const recommendations = [];
  
  if (maxSectorWeight > 50) {
    const topSector = Object.entries(sectorExposure)
      .sort(([,a], [,b]) => (b as number) - (a as number))[0];
    recommendations.push({
      action: `Diversify away from ${topSector[0]} sector`,
      rationale: `${topSector[0]} represents ${(topSector[1] as number).toFixed(1)}% of portfolio`,
      impact: 'Reduces sector concentration risk',
      priority: 'high'
    });
  }
  
  if (maxPositionWeight > 25) {
    recommendations.push({
      action: `Reduce position in ${topConcentrations[0].ticker}`,
      rationale: `Position represents ${topConcentrations[0].weight.toFixed(1)}% of portfolio`,
      impact: 'Reduces single-stock risk',
      priority: 'high'
    });
  }
  
  if (metrics.portfolio_beta > 1.3) {
    recommendations.push({
      action: 'Add defensive positions',
      rationale: `Portfolio beta of ${metrics.portfolio_beta.toFixed(2)} indicates high volatility`,
      impact: 'Reduces portfolio volatility',
      priority: 'medium'
    });
  }
  
  return {
    summary: `Portfolio analysis completed using AI agent. Total value: $${metrics.total_value.toLocaleString()}, P&L: ${metrics.total_pnl >= 0 ? '+' : ''}${metrics.total_pnl_percent.toFixed(2)}%. Portfolio beta: ${metrics.portfolio_beta.toFixed(2)}. Diversification score: ${Math.max(1, diversificationScore)}/10. This is not financial advice.`,
    recommendations: recommendations.slice(0, 3),
    agentMetadata: {
      model: 'arn:aws:bedrock:ap-southeast-1:417447013956:inference-profile/apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
      timestamp: new Date().toISOString(),
      reasoning: 'AI agent performed multi-step analysis including risk assessment, diversification analysis, and personalized recommendations',
      capabilities: ['Risk Assessment', 'Diversification Analysis', 'Performance Optimization', 'Market Analysis']
    }
  };
}

async function generateAIAnalysis(portfolio: Portfolio, metrics: any, marketData: any): Promise<any> {
  console.log('Generating AI analysis using Bedrock LLM...');
  
  try {
    // Prepare portfolio context for AI analysis
    const portfolioContext = {
      positions: portfolio.positions,
      totalValue: metrics.total_value,
      totalPnL: metrics.total_pnl,
      totalPnLPercent: metrics.total_pnl_percent,
      portfolioBeta: metrics.portfolio_beta,
      sectorExposure: metrics.sector_exposure,
      topConcentrations: metrics.top_concentrations,
      riskFlags: metrics.risk_flags,
      riskPreference: portfolio.settings.risk,
      marketData: marketData
    };

    // Create AI prompt for portfolio analysis
    const prompt = `You are a professional financial advisor AI. Analyze this portfolio and provide actionable recommendations.

PORTFOLIO DATA:
- Total Value: $${portfolioContext.totalValue.toLocaleString()}
- Total P&L: ${portfolioContext.totalPnL >= 0 ? '+' : ''}$${portfolioContext.totalPnL.toLocaleString()} (${portfolioContext.totalPnLPercent.toFixed(2)}%)
- Portfolio Beta: ${portfolioContext.portfolioBeta.toFixed(2)}
- Risk Preference: ${portfolioContext.riskPreference}
- Sector Exposure: ${JSON.stringify(portfolioContext.sectorExposure, null, 2)}
- Top Concentrations: ${JSON.stringify(portfolioContext.topConcentrations, null, 2)}
- Risk Flags: ${portfolioContext.riskFlags.length > 0 ? portfolioContext.riskFlags.join(', ') : 'None'}

POSITIONS:
${portfolioContext.positions.map(p => `- ${p.ticker}: ${p.units} shares @ $${p.cost_basis} (Current: $${marketData[p.ticker]?.price || 'N/A'})`).join('\n')}

Please provide:
1. A concise summary (2-3 sentences)
2. Top 3 specific, actionable recommendations with rationale and expected impact
3. Focus on risk management, diversification, and optimization opportunities

Format your response as JSON:
{
  "summary": "Brief portfolio summary...",
  "recommendations": [
    {
      "action": "Specific action to take",
      "rationale": "Why this action is recommended",
      "impact": "Expected outcome of this action"
    }
  ]
}

Remember: This is educational content, not financial advice.`;

    // Call Bedrock Claude model
    const bedrockResponse = await bedrockClient.send(new InvokeModelCommand({
      modelId: 'arn:aws:bedrock:ap-southeast-1:417447013956:inference-profile/apac.anthropic.claude-3-5-sonnet-20241022-v2:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    }));

    // Parse Bedrock response
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
    const aiContent = responseBody.content[0].text;
    
    console.log('Bedrock AI Response:', aiContent);
    
    // Parse AI response (handle both JSON and text formats)
    let analysis;
    try {
      // Try to extract JSON from the response
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.log('Failed to parse AI response as JSON, using fallback analysis');
      // Fallback to rule-based analysis if AI parsing fails
      analysis = await generateFallbackAnalysis(portfolio, metrics, marketData);
    }

    // Ensure we have the required structure
    if (!analysis.summary || !analysis.recommendations) {
      console.log('AI response missing required fields, using fallback');
      analysis = await generateFallbackAnalysis(portfolio, metrics, marketData);
    }

    return analysis;

  } catch (error) {
    console.error('Bedrock AI analysis failed:', error);
    console.log('Falling back to rule-based analysis');
    
    // Fallback to rule-based analysis
    return await generateFallbackAnalysis(portfolio, metrics, marketData);
  }
}

async function generateFallbackAnalysis(portfolio: Portfolio, metrics: any, marketData: any): Promise<any> {
  console.log('Using fallback rule-based analysis...');
  
  const recommendations: any[] = [];
  
  // Check sector concentration
  const topSector = Object.entries(metrics.sector_exposure)
    .sort(([,a], [,b]) => (b as number) - (a as number))[0];
  
  if (topSector && (topSector[1] as number) > 50) {
    recommendations.push({
      action: `Reduce ${topSector[0]} sector concentration`,
      rationale: `Your portfolio is heavily concentrated in ${topSector[0]} (${(topSector[1] as number).toFixed(1)}%). High sector concentration increases risk.`,
      impact: 'Diversifying across sectors can reduce volatility and improve risk-adjusted returns.',
    });
  }
  
  // Check individual position concentration
  const topPosition = metrics.top_concentrations[0];
  if (topPosition && topPosition.weight > 25) {
    recommendations.push({
      action: `Trim position in ${topPosition.ticker}`,
      rationale: `${topPosition.ticker} represents ${topPosition.weight.toFixed(1)}% of your portfolio, which is above the recommended 25% limit.`,
      impact: 'Reducing single-stock concentration helps mitigate company-specific risk.',
    });
  }
  
  // Check beta
  if (metrics.portfolio_beta > 1.3) {
    recommendations.push({
      action: 'Add defensive positions to reduce portfolio volatility',
      rationale: `Portfolio beta of ${metrics.portfolio_beta.toFixed(2)} suggests higher volatility than the market. Consider adding lower-beta stocks or bonds.`,
      impact: 'Lower beta positions can provide stability during market downturns.',
    });
  }
  
  // If no specific recommendations, provide general guidance
  if (recommendations.length === 0) {
    recommendations.push({
      action: 'Maintain current diversification strategy',
      rationale: 'Your portfolio shows balanced sector exposure and position sizing within acceptable ranges.',
      impact: 'Continue monitoring and rebalancing as needed to maintain healthy diversification.',
    });
  }
  
  // Limit to top 3 recommendations
  const topRecommendations = recommendations.slice(0, 3);
  
  const summary = `Portfolio analysis completed. Total value: $${metrics.total_value.toLocaleString()}, P&L: ${metrics.total_pnl >= 0 ? '+' : ''}${metrics.total_pnl_percent.toFixed(2)}%. Portfolio beta: ${metrics.portfolio_beta.toFixed(2)}. ${metrics.risk_flags.length > 0 ? `${metrics.risk_flags.length} risk flags identified.` : 'No major risk flags detected.'} This is not financial advice.`;
  
  return {
    summary,
    recommendations: topRecommendations,
  };
}

async function parseCsvPortfolio(csvData: string): Promise<Portfolio> {
  return new Promise((resolve, reject) => {
    const positions: PortfolioPosition[] = [];
    const stream = Readable.from([csvData]);
    
    stream
      .pipe(csv())
      .on('data', (row) => {
        positions.push({
          ticker: row.ticker?.toUpperCase() || '',
          units: parseFloat(row.units) || 0,
          cost_basis: parseFloat(row.cost_basis) || 0,
          acquisition_date: row.acquisition_date,
        });
      })
      .on('end', () => {
        resolve({
          user_id: 'demo-user',
          as_of: new Date().toISOString(),
          positions,
          cash_ccy: 'USD',
          settings: {
            risk: 'medium',
            max_single_name_weight: 0.25,
          },
        });
      })
      .on('error', reject);
  });
}

async function savePortfolio(portfolioId: string, portfolio: Portfolio): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME!,
    Key: `portfolios/${portfolioId}.json`,
    Body: JSON.stringify(portfolio),
    ContentType: 'application/json',
  });
  
  await s3Client.send(command);
}

async function getPortfolio(portfolioId: string): Promise<Portfolio> {
  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME!,
    Key: `portfolios/${portfolioId}.json`,
  });
  
  const response = await s3Client.send(command);
  const data = await response.Body?.transformToString();
  
  if (!data) {
    throw new Error('Portfolio not found');
  }
  
  return JSON.parse(data);
}

async function invokeLambda(functionName: string, payload: any): Promise<string> {
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify(payload),
  });
  
  const response = await lambdaClient.send(command);
  const result = new TextDecoder().decode(response.Payload);
  
  if (response.FunctionError) {
    throw new Error(`Lambda function error: ${result}`);
  }
  
  return result;
}
