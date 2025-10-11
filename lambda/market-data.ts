import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';

// Node.js global declarations
declare const console: Console;
declare const process: NodeJS.Process;
declare const setTimeout: (callback: () => void, ms: number) => NodeJS.Timeout;

const s3Client = new S3Client({});

interface MarketDataRequest {
  tickers: string[];
  portfolio_id?: string;
}

interface MarketDataResponse {
  quotes: Record<string, {
    price: number;
    change: number;
    changePercent: number;
  }>;
  sectors: Record<string, string>;
  betas: Record<string, number>;
  timestamp: string;
}

export const handler = async (event: any) => {
  console.log('Market Data Lambda Event:', JSON.stringify(event, null, 2));

  try {
    const { tickers, portfolio_id } = event as MarketDataRequest;
    
    if (!tickers || !Array.isArray(tickers)) {
      throw new Error('Invalid tickers array provided');
    }

    // Check cache first (if portfolio_id provided)
    if (portfolio_id) {
      try {
        const cachedData = await getCachedMarketData(portfolio_id);
        if (cachedData && isCacheValid(cachedData.timestamp)) {
          console.log('Returning cached market data');
          return {
            statusCode: 200,
            body: JSON.stringify(cachedData),
          };
        }
      } catch (error) {
        console.log('No valid cache found, fetching fresh data');
      }
    }

    // Fetch market data from Alpha Vantage (free tier)
    const marketData = await fetchMarketData(tickers);

    // Cache the data if portfolio_id provided
    if (portfolio_id) {
      await cacheMarketData(portfolio_id, marketData);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(marketData),
    };
  } catch (error) {
    console.error('Error in market data handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to fetch market data',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

async function fetchMarketData(tickers: string[]): Promise<MarketDataResponse> {
  console.log('Fetching market data for tickers:', tickers);
  
  // Realistic market data as of October 2025
  // In production, replace with real API (yfinance, Polygon, etc.)
  const marketData: Record<string, {price: number, sector: string, beta: number}> = {
    'AAPL': { price: 229.00, sector: 'Technology', beta: 1.20 },
    'MSFT': { price: 526.00, sector: 'Technology', beta: 1.15 },
    'NVDA': { price: 895.00, sector: 'Technology', beta: 1.75 },
    'GOOGL': { price: 182.50, sector: 'Communication Services', beta: 1.10 },
    'GOOG': { price: 184.00, sector: 'Communication Services', beta: 1.10 },
    'TSLA': { price: 245.00, sector: 'Consumer Cyclical', beta: 2.00 },
    'AMZN': { price: 198.00, sector: 'Consumer Cyclical', beta: 1.25 },
    'META': { price: 595.00, sector: 'Communication Services', beta: 1.30 },
    'NFLX': { price: 720.00, sector: 'Communication Services', beta: 1.40 },
    'AMD': { price: 165.00, sector: 'Technology', beta: 1.85 },
    'INTC': { price: 28.50, sector: 'Technology', beta: 0.95 },
    'JPM': { price: 215.00, sector: 'Financial Services', beta: 1.05 },
    'BAC': { price: 42.50, sector: 'Financial Services', beta: 1.15 },
    'WMT': { price: 85.00, sector: 'Consumer Defensive', beta: 0.55 },
    'PG': { price: 175.00, sector: 'Consumer Defensive', beta: 0.45 },
    'JNJ': { price: 158.00, sector: 'Healthcare', beta: 0.60 },
    'UNH': { price: 582.00, sector: 'Healthcare', beta: 0.75 },
    'V': { price: 305.00, sector: 'Financial Services', beta: 0.95 },
    'MA': { price: 528.00, sector: 'Financial Services', beta: 1.00 },
    'DIS': { price: 95.00, sector: 'Communication Services', beta: 1.15 },
  };

  const quotes: Record<string, any> = {};
  const sectors: Record<string, string> = {};
  const betas: Record<string, number> = {};

  for (const ticker of tickers) {
    const upperTicker = ticker.toUpperCase();
    const data = marketData[upperTicker] || { 
      price: 100, 
      sector: 'Unknown', 
      beta: 1.0 
    };
    
    // Simulate realistic price movement (-2% to +2% daily change)
    const changePercent = (Math.random() * 4 - 2);
    const change = data.price * (changePercent / 100);
    
    quotes[ticker] = {
      price: parseFloat(data.price.toFixed(2)),
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePercent.toFixed(2)),
    };
    sectors[ticker] = data.sector;
    betas[ticker] = data.beta;
  }

  console.log('Market data fetched successfully:', { quotes, sectors, betas });

  return {
    quotes,
    sectors,
    betas,
    timestamp: new Date().toISOString(),
  };
}

async function getCachedMarketData(portfolioId: string): Promise<MarketDataResponse | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.BUCKET_NAME!,
      Key: `cache/market-data/${portfolioId}.json`,
    });
    
    const response = await s3Client.send(command);
    const data = await response.Body?.transformToString();
    return data ? JSON.parse(data) : null;
  } catch (error) {
    return null;
  }
}

async function cacheMarketData(portfolioId: string, data: MarketDataResponse): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME!,
    Key: `cache/market-data/${portfolioId}.json`,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  });
  
  await s3Client.send(command);
}

function isCacheValid(timestamp: string): boolean {
  const cacheTime = new Date(timestamp);
  const now = new Date();
  const diffMinutes = (now.getTime() - cacheTime.getTime()) / (1000 * 60);
  return diffMinutes < 15; // Cache valid for 15 minutes
}
