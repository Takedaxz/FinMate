import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({});

/**
 * Parse Java-style object notation to JavaScript object
 * Example: "{AAPL={shares=15, cost_basis=150}}" -> {AAPL: {shares: 15, cost_basis: 150}}
 */
function parseJavaStyleObject(str: string): any {
  console.log('Parsing Java-style object:', str);
  
  // Remove outer braces
  str = str.trim();
  if (str.startsWith('{') && str.endsWith('}')) {
    str = str.slice(1, -1);
  }
  
  const result: any = {};
  let i = 0;
  
  while (i < str.length) {
    // Skip whitespace
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) break;
    
    // Find key (until =)
    let keyStart = i;
    while (i < str.length && str[i] !== '=') i++;
    const key = str.slice(keyStart, i).trim();
    
    // Skip =
    i++;
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) break;
    
    // Check if value is an array
    if (str[i] === '[') {
      // Find matching closing bracket
      let bracketCount = 0;
      let valueStart = i;
      while (i < str.length) {
        if (str[i] === '[') bracketCount++;
        else if (str[i] === ']') bracketCount--;
        i++;
        if (bracketCount === 0) break;
      }
      
      const valueStr = str.slice(valueStart, i);
      result[key] = parseJavaStyleArray(valueStr);
    } else if (str[i] === '{') {
      // Find matching closing brace
      let braceCount = 0;
      let valueStart = i;
      while (i < str.length) {
        if (str[i] === '{') braceCount++;
        else if (str[i] === '}') braceCount--;
        i++;
        if (braceCount === 0) break;
      }
      
      const valueStr = str.slice(valueStart, i);
      result[key] = parseJavaStyleObject(valueStr);
    } else {
      // Simple value - find until comma or end
      let valueStart = i;
      while (i < str.length && str[i] !== ',') i++;
      const valueStr = str.slice(valueStart, i).trim();
      
      if (valueStr === '') {
        result[key] = null;
      } else if (!isNaN(Number(valueStr))) {
        result[key] = Number(valueStr);
      } else {
        result[key] = valueStr;
      }
    }
    
    // Skip comma
    while (i < str.length && (str[i] === ',' || /\s/.test(str[i]))) i++;
  }
  
  console.log('Parsed result:', result);
  return result;
}

/**
 * Parse Java-style array notation to JavaScript array
 * Example: "[{shares=15, cost_basis=150, ticker=AAPL}]" -> [{shares: 15, cost_basis: 150, ticker: "AAPL"}]
 */
function parseJavaStyleArray(str: string): any[] {
  console.log('Parsing Java-style array:', str);
  
  // Remove outer brackets
  str = str.trim();
  if (str.startsWith('[') && str.endsWith(']')) {
    str = str.slice(1, -1);
  }
  
  if (str.trim() === '') {
    return [];
  }
  
  const result: any[] = [];
  let i = 0;
  
  while (i < str.length) {
    // Skip whitespace
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) break;
    
    // Check if element is an object
    if (str[i] === '{') {
      // Find matching closing brace
      let braceCount = 0;
      let valueStart = i;
      while (i < str.length) {
        if (str[i] === '{') braceCount++;
        else if (str[i] === '}') braceCount--;
        i++;
        if (braceCount === 0) break;
      }
      
      const valueStr = str.slice(valueStart, i);
      result.push(parseJavaStyleObject(valueStr));
    } else {
      // Simple value - find until comma or end
      let valueStart = i;
      while (i < str.length && str[i] !== ',') i++;
      const valueStr = str.slice(valueStart, i).trim();
      
      if (valueStr === '') {
        result.push(null);
      } else if (!isNaN(Number(valueStr))) {
        result.push(Number(valueStr));
      } else {
        result.push(valueStr);
      }
    }
    
    // Skip comma
    while (i < str.length && (str[i] === ',' || /\s/.test(str[i]))) i++;
  }
  
  console.log('Parsed array result:', result);
  return result;
}

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
  console.log('Request body structure:', JSON.stringify(requestBody, null, 2));
  
  let portfolio: any;
  let marketData: any;

  // Try multiple parsing strategies
  if (requestBody?.content) {
    // Strategy 1: Handle requestBody.content structure from agent
    if (requestBody.content['application/json']?.properties) {
      const properties = requestBody.content['application/json'].properties;
      const portfolioProp = properties.find((p: any) => p.name === 'portfolio');
      const marketDataProp = properties.find((p: any) => p.name === 'market_data');
      
      if (portfolioProp?.value) {
        try {
          if (typeof portfolioProp.value === 'string') {
            // Try JSON parse first
            try {
              portfolio = JSON.parse(portfolioProp.value);
            } catch {
              // If JSON fails, try parsing Java-style object notation
              portfolio = parseJavaStyleObject(portfolioProp.value);
            }
          } else {
            portfolio = portfolioProp.value;
          }
          console.log('Parsed portfolio from properties:', typeof portfolio);
        } catch (error) {
          console.error('Error parsing portfolio from properties:', error);
          console.log('Raw portfolio value:', portfolioProp.value);
        }
      }
      
      if (marketDataProp?.value) {
        try {
          if (typeof marketDataProp.value === 'string') {
            // Try JSON parse first
            try {
              marketData = JSON.parse(marketDataProp.value);
            } catch {
              // If JSON fails, try parsing Java-style object notation
              marketData = parseJavaStyleObject(marketDataProp.value);
            }
          } else {
            marketData = marketDataProp.value;
          }
          console.log('Parsed market_data from properties:', typeof marketData);
        } catch (error) {
          console.error('Error parsing market_data from properties:', error);
          console.log('Raw market_data value:', marketDataProp.value);
        }
      }
    } else {
      // Strategy 2: Direct content access
      portfolio = requestBody.content.portfolio;
      marketData = requestBody.content.market_data;
      console.log('Direct content access - portfolio:', typeof portfolio, 'market_data:', typeof marketData);
    }
  }

  // Strategy 3: Check if data is in parameters
  if ((!portfolio || !marketData) && parameters && parameters.length > 0) {
    console.log('Checking parameters for data...');
    for (const param of parameters) {
      if (param.name === 'portfolio' && param.value) {
        try {
          portfolio = typeof param.value === 'string' ? JSON.parse(param.value) : param.value;
          console.log('Found portfolio in parameters');
        } catch (error) {
          console.error('Error parsing portfolio from parameters:', error);
        }
      }
      if (param.name === 'market_data' && param.value) {
        try {
          marketData = typeof param.value === 'string' ? JSON.parse(param.value) : param.value;
          console.log('Found market_data in parameters');
        } catch (error) {
          console.error('Error parsing market_data from parameters:', error);
        }
      }
    }
  }

  if (!portfolio || !marketData) {
    console.error('Missing required parameters - portfolio:', !!portfolio, 'market_data:', !!marketData);
    console.log('Available data:', { requestBody, parameters });
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
          if (typeof metricsProp.value === 'string') {
            // Try JSON parse first
            try {
              portfolioMetrics = JSON.parse(metricsProp.value);
            } catch {
              // If JSON fails, try parsing Java-style object notation
              portfolioMetrics = parseJavaStyleObject(metricsProp.value);
            }
          } else {
            portfolioMetrics = metricsProp.value;
          }
        } catch (error) {
          console.error('Error parsing portfolio_metrics:', error);
        }
      }
      
      if (summaryProp?.value) {
        analysisSummary = summaryProp.value;
      }
      
      if (recsProp?.value) {
        try {
          if (typeof recsProp.value === 'string') {
            // Try JSON parse first
            try {
              recommendations = JSON.parse(recsProp.value);
            } catch {
              // If JSON fails, try parsing Java-style array notation
              recommendations = parseJavaStyleArray(recsProp.value);
            }
          } else {
            recommendations = recsProp.value;
          }
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

  // Generate a comprehensive analysis summary if not provided
  const comprehensiveAnalysis = analysisSummary || generateComprehensiveAnalysis(portfolioMetrics);
  
  // Invoke write report Lambda
  const response = await invokeLambda(process.env.WRITE_REPORT_FUNCTION!, {
    portfolio_metrics: portfolioMetrics,
    analysis_summary: comprehensiveAnalysis,
    recommendations: recommendations || [],
    user_id: userId,
    generated_at: new Date().toISOString()
  });

  return response;
}

function generateComprehensiveAnalysis(portfolioMetrics: any): string {
  const totalValue = portfolioMetrics.total_value || 0;
  const totalPnl = portfolioMetrics.total_pnl || 0;
  const totalPnlPercent = portfolioMetrics.total_pnl_percent || 0;
  const portfolioBeta = portfolioMetrics.portfolio_beta || 1.0;
  const riskFlags = portfolioMetrics.risk_flags || [];
  const positions = portfolioMetrics.positions || [];
  const sectorExposure = portfolioMetrics.sector_exposure || {};
  
  let analysis = `## Portfolio Performance Analysis\n\n`;
  
  // Performance Summary
  analysis += `**Portfolio Performance:**\n`;
  analysis += `- Total Portfolio Value: $${totalValue.toLocaleString()}\n`;
  analysis += `- Total P&L: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toLocaleString()} (${totalPnlPercent >= 0 ? '+' : ''}${totalPnlPercent.toFixed(2)}%)\n`;
  analysis += `- Portfolio Beta: ${portfolioBeta.toFixed(2)}\n\n`;
  
  // Risk Assessment
  if (riskFlags.length > 0) {
    analysis += `**Risk Assessment:**\n`;
    riskFlags.forEach((flag: string) => {
      analysis += `- ⚠️ ${flag}\n`;
    });
    analysis += `\n`;
  }
  
  // Sector Analysis
  if (Object.keys(sectorExposure).length > 0) {
    analysis += `**Sector Diversification:**\n`;
    Object.entries(sectorExposure).forEach(([sector, exposure]) => {
      analysis += `- ${sector}: ${(exposure as number).toFixed(1)}%\n`;
    });
    analysis += `\n`;
  }
  
  // Position Analysis
  if (positions.length > 0) {
    analysis += `**Top Holdings Analysis:**\n`;
    positions.slice(0, 5).forEach((pos: any) => {
      analysis += `- **${pos.ticker}**: ${pos.weight?.toFixed(1) || 'N/A'}% weight, ${pos.pnl_percent >= 0 ? '+' : ''}${pos.pnl_percent?.toFixed(2) || 'N/A'}% return\n`;
    });
    analysis += `\n`;
  }
  
  // Recommendations
  analysis += `**Key Recommendations:**\n`;
  if (riskFlags.length > 0) {
    analysis += `- **Diversification**: Consider reducing concentration risk by diversifying across more positions and sectors\n`;
  }
  if (portfolioBeta > 1.2) {
    analysis += `- **Risk Management**: Portfolio beta of ${portfolioBeta.toFixed(2)} indicates higher volatility; consider adding lower-beta assets\n`;
  }
  if (totalPnlPercent > 20) {
    analysis += `- **Profit Taking**: Strong performance of ${totalPnlPercent.toFixed(2)}% may warrant considering partial profit-taking\n`;
  } else if (totalPnlPercent < -10) {
    analysis += `- **Loss Management**: Consider reviewing underperforming positions and potential rebalancing\n`;
  }
  
  analysis += `\n*This analysis is based on current market data and portfolio metrics. Please consult with a financial advisor for personalized investment advice.*`;
  
  return analysis;
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

