import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({});

// Bedrock Agent action group request format
interface AgentActionRequest {
  messageVersion: string;
  agent: {
    name: string;
    id: string;
    alias: string;
    version: string;
  };
  inputText: string;
  sessionId: string;
  actionGroup: string;
  apiPath: string;
  httpMethod: string;
  parameters?: Array<{
    name: string;
    type: string;
    value: string;
  }>;
  requestBody?: {
    content: {
      [key: string]: any;
    };
  };
}

// Bedrock Agent action group response format
interface AgentActionResponse {
  messageVersion: string;
  response: {
    actionGroup: string;
    apiPath: string;
    httpMethod: string;
    httpStatusCode: number;
    responseBody: {
      'application/json': {
        body: string;
      };
    };
  };
}

export const handler = async (event: AgentActionRequest): Promise<AgentActionResponse> => {
  console.log('Agent Tools Orchestrator Event:', JSON.stringify(event, null, 2));

  try {
    const { apiPath, parameters, requestBody, actionGroup, httpMethod } = event;

    let result: any;
    let statusCode = 200;

    // Route to appropriate tool based on API path
    switch (apiPath) {
      case '/get_market_data':
        result = await handleGetMarketData(parameters, requestBody);
        break;
      
      case '/compute_metrics':
        result = await handleComputeMetrics(parameters, requestBody);
        break;
      
      case '/write_report':
        result = await handleWriteReport(parameters, requestBody);
        break;
      
      default:
        statusCode = 404;
        result = {
          error: 'Unknown API path',
          apiPath: apiPath
        };
    }

    // Return in Bedrock Agent format
    return {
      messageVersion: '1.0',
      response: {
        actionGroup: actionGroup,
        apiPath: apiPath,
        httpMethod: httpMethod,
        httpStatusCode: statusCode,
        responseBody: {
          'application/json': {
            body: JSON.stringify(result)
          }
        }
      }
    };

  } catch (error) {
    console.error('Error in agent tools orchestrator:', error);
    
    return {
      messageVersion: '1.0',
      response: {
        actionGroup: event.actionGroup,
        apiPath: event.apiPath,
        httpMethod: event.httpMethod,
        httpStatusCode: 500,
        responseBody: {
          'application/json': {
            body: JSON.stringify({
              error: 'Internal server error',
              message: error instanceof Error ? error.message : 'Unknown error'
            })
          }
        }
      }
    };
  }
};

async function handleGetMarketData(parameters?: Array<any>, requestBody?: any): Promise<any> {
  console.log('Handling get_market_data with parameters:', parameters);
  
  // Extract tickers from parameters or request body
  let tickers: string[] = [];
  let portfolioId: string | undefined;

  if (parameters) {
    const tickersParam = parameters.find(p => p.name === 'tickers');
    const portfolioIdParam = parameters.find(p => p.name === 'portfolio_id');
    
    if (tickersParam) {
      try {
        // Handle both array format and string format
        if (Array.isArray(tickersParam.value)) {
          tickers = tickersParam.value;
        } else if (typeof tickersParam.value === 'string') {
          const value = tickersParam.value.trim();
          
          // Try to parse as JSON first
          try {
            tickers = JSON.parse(value);
          } catch {
            // If JSON parse fails, check if it's array-like format: [AAPL] or [AAPL,MSFT]
            if (value.startsWith('[') && value.endsWith(']')) {
              const inner = value.slice(1, -1).trim();
              if (inner) {
                // Split by comma and clean up
                tickers = inner.split(',').map(t => t.trim()).filter(t => t.length > 0);
              } else {
                tickers = [];
              }
            } else {
              // Treat as single ticker
              tickers = [value];
            }
          }
        }
      } catch (error) {
        console.error('Error parsing tickers parameter:', error);
        tickers = [];
      }
    }
    if (portfolioIdParam) {
      portfolioId = portfolioIdParam.value;
    }
  }

  if (requestBody?.content) {
    // Handle requestBody.content structure from agent
    if (requestBody.content['application/json']?.properties) {
      const properties = requestBody.content['application/json'].properties;
      const tickersProp = properties.find((p: any) => p.name === 'tickers');
      if (tickersProp) {
        try {
          if (Array.isArray(tickersProp.value)) {
            tickers = tickersProp.value;
          } else if (typeof tickersProp.value === 'string') {
            const value = tickersProp.value.trim();
            
            try {
              tickers = JSON.parse(value);
            } catch {
              // If JSON parse fails, check if it's array-like format: [AAPL] or [AAPL,MSFT]
              if (value.startsWith('[') && value.endsWith(']')) {
                const inner = value.slice(1, -1).trim();
                if (inner) {
                  // Split by comma and clean up
                  tickers = inner.split(',').map(t => t.trim()).filter(t => t.length > 0);
                } else {
                  tickers = [];
                }
              } else {
                // Treat as single ticker
                tickers = [value];
              }
            }
          }
        } catch (error) {
          console.error('Error parsing tickers from requestBody:', error);
        }
      }
    } else {
      // Fallback to direct content access
      tickers = requestBody.content.tickers || tickers;
      portfolioId = requestBody.content.portfolio_id || portfolioId;
    }
  }

  // Invoke market data Lambda
  const response = await invokeLambda(process.env.MARKET_DATA_FUNCTION!, {
    tickers,
    portfolio_id: portfolioId
  });

  return response;
}

async function handleComputeMetrics(parameters?: Array<any>, requestBody?: any): Promise<any> {
  console.log('Handling compute_metrics with parameters:', parameters);
  
  let portfolio: any;
  let marketData: any;

  if (requestBody?.content) {
    // Handle requestBody.content structure from agent
    if (requestBody.content['application/json']?.properties) {
      const properties = requestBody.content['application/json'].properties;
      const portfolioProp = properties.find((p: any) => p.name === 'portfolio');
      const marketDataProp = properties.find((p: any) => p.name === 'market_data');
      
      if (portfolioProp?.value) {
        try {
          portfolio = typeof portfolioProp.value === 'string' ? JSON.parse(portfolioProp.value) : portfolioProp.value;
        } catch (error) {
          console.error('Error parsing portfolio:', error);
        }
      }
      
      if (marketDataProp?.value) {
        try {
          marketData = typeof marketDataProp.value === 'string' ? JSON.parse(marketDataProp.value) : marketDataProp.value;
        } catch (error) {
          console.error('Error parsing market_data:', error);
        }
      }
    } else {
      // Fallback to direct content access
      portfolio = requestBody.content.portfolio;
      marketData = requestBody.content.market_data;
    }
  }

  if (!portfolio || !marketData) {
    throw new Error('Missing required parameters: portfolio and market_data');
  }

  // Invoke compute metrics Lambda
  const response = await invokeLambda(process.env.COMPUTE_METRICS_FUNCTION!, {
    portfolio,
    market_data: marketData
  });

  return response;
}

async function handleWriteReport(parameters?: Array<any>, requestBody?: any): Promise<any> {
  console.log('Handling write_report with parameters:', parameters);
  
  let portfolioMetrics: any;
  let analysisSummary: string | undefined;
  let recommendations: any[] | undefined;
  let userId: string = 'demo-user';

  if (requestBody?.content) {
    // Handle requestBody.content structure from agent
    if (requestBody.content['application/json']?.properties) {
      const properties = requestBody.content['application/json'].properties;
      const metricsProp = properties.find((p: any) => p.name === 'portfolio_metrics');
      const summaryProp = properties.find((p: any) => p.name === 'analysis_summary');
      const recsProp = properties.find((p: any) => p.name === 'recommendations');
      const userIdProp = properties.find((p: any) => p.name === 'user_id');
      
      if (metricsProp?.value) {
        try {
          portfolioMetrics = typeof metricsProp.value === 'string' ? JSON.parse(metricsProp.value) : metricsProp.value;
        } catch (error) {
          console.error('Error parsing portfolio_metrics:', error);
        }
      }
      
      if (summaryProp?.value) {
        analysisSummary = summaryProp.value;
      }
      
      if (recsProp?.value) {
        try {
          recommendations = typeof recsProp.value === 'string' ? JSON.parse(recsProp.value) : recsProp.value;
        } catch (error) {
          console.error('Error parsing recommendations:', error);
        }
      }
      
      if (userIdProp?.value) {
        userId = userIdProp.value;
      }
    } else {
      // Fallback to direct content access
      portfolioMetrics = requestBody.content.portfolio_metrics;
      analysisSummary = requestBody.content.analysis_summary;
      recommendations = requestBody.content.recommendations;
      userId = requestBody.content.user_id || 'demo-user';
    }
  }

  if (!portfolioMetrics) {
    throw new Error('Missing required parameter: portfolio_metrics');
  }

  // Invoke write report Lambda
  const response = await invokeLambda(process.env.WRITE_REPORT_FUNCTION!, {
    portfolio_metrics: portfolioMetrics,
    analysis_summary: analysisSummary || 'Portfolio analysis completed',
    recommendations: recommendations || [],
    user_id: userId,
    generated_at: new Date().toISOString()
  });

  return response;
}

async function invokeLambda(functionName: string, payload: any): Promise<any> {
  console.log(`Invoking Lambda: ${functionName}`);
  
  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify(payload),
  });
  
  const response = await lambdaClient.send(command);
  
  if (response.FunctionError) {
    const errorPayload = new TextDecoder().decode(response.Payload);
    throw new Error(`Lambda function error: ${errorPayload}`);
  }
  
  const result = new TextDecoder().decode(response.Payload);
  const parsed = JSON.parse(result);
  
  // Extract body if it's wrapped in API Gateway format
  if (parsed.body) {
    return JSON.parse(parsed.body);
  }
  
  return parsed;
}

