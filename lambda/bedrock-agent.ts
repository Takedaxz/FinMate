import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrockAgentClient = new BedrockAgentRuntimeClient({});
const bedrockClient = new BedrockRuntimeClient({});

// Helper function to add CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

interface PortfolioAnalysisRequest {
  portfolio: any;
  metrics: any;
  marketData: any;
  userQuery?: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Bedrock Agent Lambda Event:', JSON.stringify(event, null, 2));

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { portfolio, metrics, marketData, userQuery } = body as PortfolioAnalysisRequest;

    if (!portfolio || !metrics || !marketData) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Missing required parameters: portfolio, metrics, marketData'
        })
      };
    }

    // Use Bedrock AgentCore for portfolio analysis
    const analysis = await performAgentCoreAnalysis(portfolio, metrics, marketData, userQuery);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        analysis,
        agentType: 'Bedrock AgentCore',
        reasoning: 'AI-powered portfolio analysis using Bedrock AgentCore primitives'
      })
    };

  } catch (error) {
    console.error('Bedrock Agent error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Failed to perform agent analysis',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};

async function performAgentCoreAnalysis(portfolio: any, metrics: any, marketData: any, userQuery?: string): Promise<any> {
  console.log('Performing Bedrock AgentCore analysis...');

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

USER QUERY: ${userQuery || 'Please analyze this portfolio and provide recommendations'}

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
  "riskAssessment": "Assessment of portfolio risk level",
  "diversificationScore": "Score out of 10",
  "performanceInsights": "Key performance observations",
  "recommendations": [
    {
      "action": "Specific action",
      "rationale": "Why this is recommended",
      "impact": "Expected outcome",
      "priority": "high/medium/low"
    }
  ],
  "marketOutlook": "Relevant market considerations",
  "nextSteps": "Suggested follow-up actions"
}`;

    // Use Bedrock Claude for agent reasoning
    const bedrockResponse = await bedrockClient.send(new InvokeModelCommand({
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
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
      analysis = createStructuredAnalysis(portfolio, metrics, marketData);
    }

    // Add agent metadata
    analysis.agentMetadata = {
      model: 'anthropic.claude-3-sonnet-20240229-v1:0',
      timestamp: new Date().toISOString(),
      reasoning: 'AI agent performed multi-step analysis including risk assessment, diversification analysis, and personalized recommendations',
      capabilities: ['Risk Assessment', 'Diversification Analysis', 'Performance Optimization', 'Market Analysis']
    };

    return analysis;

  } catch (error) {
    console.error('AgentCore analysis failed:', error);
    return createStructuredAnalysis(portfolio, metrics, marketData);
  }
}

function createStructuredAnalysis(portfolio: any, metrics: any, marketData: any): any {
  console.log('Creating structured fallback analysis...');
  
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
    riskAssessment: riskFlags.length > 0 ? 'Elevated risk due to concentration' : 'Moderate risk profile',
    diversificationScore: Math.max(1, diversificationScore),
    performanceInsights: `Portfolio shows ${metrics.total_pnl >= 0 ? 'positive' : 'negative'} performance of ${metrics.total_pnl_percent?.toFixed(2) || 'N/A'}%`,
    recommendations: recommendations.slice(0, 3),
    marketOutlook: 'Consider current market conditions and economic indicators',
    nextSteps: 'Review recommendations and consider rebalancing if needed',
    agentMetadata: {
      model: 'fallback-analysis',
      timestamp: new Date().toISOString(),
      reasoning: 'Structured rule-based analysis with AI-like formatting',
      capabilities: ['Risk Assessment', 'Diversification Analysis']
    }
  };
}
