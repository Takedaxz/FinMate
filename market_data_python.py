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
                print(f"Fetching data for {ticker}...")
                stock = stocks.tickers[ticker]
                
                # Get historical data first (more reliable)
                hist = stock.history(period='2d')  # Get 2 days to calculate change
                
                if hist.empty:
                    print(f"No historical data for {ticker}")
                    raise Exception("No historical data available")
                
                # Get current price from latest close
                current_price = float(hist['Close'].iloc[-1])
                previous_close = float(hist['Close'].iloc[-2]) if len(hist) > 1 else current_price
                
                # Calculate change
                change = current_price - previous_close
                change_percent = (change / previous_close * 100) if previous_close > 0 else 0
                
                quotes[ticker] = {
                    'price': round(current_price, 2),
                    'change': round(change, 2),
                    'changePercent': round(change_percent, 2)
                }
                
                # Try to get info data (might fail due to rate limits)
                try:
                    info = stock.info
                    sectors[ticker] = info.get('sector', 'Technology')  # Default to Technology for tech stocks
                    betas[ticker] = info.get('beta', 1.0) or 1.0
                    print(f"Info data retrieved for {ticker}: sector={sectors[ticker]}, beta={betas[ticker]}")
                except Exception as info_error:
                    print(f"Info data failed for {ticker}: {str(info_error)}")
                    # Set reasonable defaults based on ticker
                    if ticker.upper() in ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA']:
                        sectors[ticker] = 'Technology'
                        betas[ticker] = 1.2  # Tech stocks typically have higher beta
                    elif ticker.upper() in ['JPM', 'BAC', 'WFC', 'GS']:
                        sectors[ticker] = 'Financial Services'
                        betas[ticker] = 1.1
                    else:
                        sectors[ticker] = 'Unknown'
                        betas[ticker] = 1.0
                
                print(f"Successfully processed {ticker}: price=${current_price}, change=${change}")
                
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
