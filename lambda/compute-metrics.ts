import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

// Node.js global declarations
declare const console: Console;

const s3Client = new S3Client({});

interface Position {
  ticker: string;
  units: number;
  cost_basis: number;
  acquisition_date?: string;
  
}

interface MarketData {
  quotes: Record<string, { price: number; change: number; changePercent: number }>;
  sectors: Record<string, string>;
  betas: Record<string, number>;
  timestamp: string;
}

interface PortfolioMetrics {
  total_value: number;
  total_cost: number;
  total_pnl: number;
  total_pnl_percent: number;
  positions: Array<{
    ticker: string;
    units: number;
    current_price: number;
    cost_basis: number;
    current_value: number;
    pnl: number;
    pnl_percent: number;
    weight: number;
    sector: string;
    beta: number;
  }>;
  sector_exposure: Record<string, number>;
  top_concentrations: Array<{ ticker: string; weight: number; sector: string }>;
  portfolio_beta: number;
  risk_flags: string[];
}

interface ComputeMetricsRequest {
  portfolio: {
    user_id: string;
    positions: Position[];
    cash_ccy: string;
    settings: {
      risk: string;
      max_single_name_weight: number;
    };
  };
  market_data: MarketData;
}

export const handler = async (event: any) => {
  console.log('Compute Metrics Lambda Event:', JSON.stringify(event, null, 2));

  try {
    const { portfolio, market_data } = event as ComputeMetricsRequest;
    
    if (!portfolio || !market_data) {
      throw new Error('Portfolio and market data are required');
    }

    const metrics = computePortfolioMetrics(portfolio, market_data);

    return {
      statusCode: 200,
      body: JSON.stringify(metrics),
    };
  } catch (error) {
    console.error('Error in compute metrics handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to compute portfolio metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

function computePortfolioMetrics(portfolio: any, marketData: MarketData): PortfolioMetrics {
  const positions = portfolio.positions;
  const riskSettings = portfolio.settings;
  
  let totalValue = 0;
  let totalCost = 0;
  const processedPositions: any[] = [];
  const sectorExposure: Record<string, number> = {};
  const riskFlags: string[] = [];

  // Process each position
  for (const position of positions) {
    const ticker = position.ticker;
    const units = position.units;
    const costBasis = position.cost_basis;
    
    const currentPrice = marketData.quotes[ticker]?.price || 0;
    const currentValue = units * currentPrice;
    const totalCostBasis = units * costBasis;
    const pnl = currentValue - totalCostBasis;
    const pnlPercent = totalCostBasis > 0 ? (pnl / totalCostBasis) * 100 : 0;
    
    const sector = marketData.sectors[ticker] || 'Unknown';
    const beta = marketData.betas[ticker] || 1.0;

    processedPositions.push({
      ticker,
      units,
      current_price: currentPrice,
      cost_basis: costBasis,
      current_value: currentValue,
      pnl,
      pnl_percent: pnlPercent,
      sector,
      beta,
    });

    totalValue += currentValue;
    totalCost += totalCostBasis;

    // Track sector exposure
    sectorExposure[sector] = (sectorExposure[sector] || 0) + currentValue;
  }

  // Calculate weights and finalize sector exposure
  for (const position of processedPositions) {
    position.weight = totalValue > 0 ? (position.current_value / totalValue) * 100 : 0;
  }

  // Convert sector exposure to percentages
  for (const sector in sectorExposure) {
    sectorExposure[sector] = (sectorExposure[sector] / totalValue) * 100;
  }

  // Calculate portfolio beta (weighted average)
  const portfolioBeta = processedPositions.reduce((sum, pos) => {
    return sum + (pos.beta * pos.weight / 100);
  }, 0);

  // Find top concentrations
  const topConcentrations = processedPositions
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(pos => ({
      ticker: pos.ticker,
      weight: pos.weight,
      sector: pos.sector,
    }));

  // Generate risk flags
  const maxSingleWeight = riskSettings.max_single_name_weight * 100;
  for (const position of processedPositions) {
    if (position.weight > maxSingleWeight) {
      riskFlags.push(
        `High concentration in ${position.ticker}: ${position.weight.toFixed(1)}% (limit: ${maxSingleWeight}%)`
      );
    }
  }

  // Check sector concentration
  for (const [sector, exposure] of Object.entries(sectorExposure)) {
    if (exposure > 50) {
      riskFlags.push(
        `High sector concentration in ${sector}: ${exposure.toFixed(1)}%`
      );
    }
  }

  // Check portfolio beta
  if (portfolioBeta > 1.5) {
    riskFlags.push(`High portfolio beta: ${portfolioBeta.toFixed(2)} (market beta: 1.0)`);
  } else if (portfolioBeta < 0.5) {
    riskFlags.push(`Low portfolio beta: ${portfolioBeta.toFixed(2)} (may underperform in bull markets)`);
  }

  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return {
    total_value: totalValue,
    total_cost: totalCost,
    total_pnl: totalPnl,
    total_pnl_percent: totalPnlPercent,
    positions: processedPositions,
    sector_exposure: sectorExposure,
    top_concentrations: topConcentrations,
    portfolio_beta: portfolioBeta,
    risk_flags: riskFlags,
  };
}
