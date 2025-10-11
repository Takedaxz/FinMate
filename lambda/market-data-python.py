import json
import yfinance as yf
from datetime import datetime

def handler(event, context):
    """
    Fetch real-time market data using yfinance
    """
    print(f"Market Data Lambda Event: {json.dumps(event)}")
    
    try:
        tickers = event.get('tickers', [])
        
        if not tickers or not isinstance(tickers, list):
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Invalid tickers array provided'})
            }
        
        # Fetch data for all tickers at once (much faster than one by one)
        tickers_str = ' '.join(tickers)
        stocks = yf.Tickers(tickers_str)
        
        quotes = {}
        sectors = {}
        betas = {}
        
        for ticker in tickers:
            try:
                stock = stocks.tickers[ticker]
                info = stock.info
                hist = stock.history(period='1d')
                
                # Get current price
                current_price = info.get('currentPrice') or info.get('regularMarketPrice', 0)
                previous_close = info.get('previousClose', current_price)
                
                # Calculate change
                change = current_price - previous_close
                change_percent = (change / previous_close * 100) if previous_close > 0 else 0
                
                quotes[ticker] = {
                    'price': round(current_price, 2),
                    'change': round(change, 2),
                    'changePercent': round(change_percent, 2)
                }
                
                # Get sector and industry
                sectors[ticker] = info.get('sector', 'Unknown')
                
                # Get beta (measure of volatility)
                betas[ticker] = info.get('beta', 1.0) or 1.0
                
            except Exception as e:
                print(f"Error fetching data for {ticker}: {str(e)}")
                # Set defaults for failed requests
                quotes[ticker] = {'price': 0, 'change': 0, 'changePercent': 0}
                sectors[ticker] = 'Unknown'
                betas[ticker] = 1.0
        
        response_data = {
            'quotes': quotes,
            'sectors': sectors,
            'betas': betas,
            'timestamp': datetime.now().isoformat()
        }
        
        return {
            'statusCode': 200,
            'body': json.dumps(response_data)
        }
        
    except Exception as error:
        print(f"Error in market data handler: {str(error)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Failed to fetch market data',
                'message': str(error)
            })
        }
