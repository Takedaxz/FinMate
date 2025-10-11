import json
import urllib.request
import urllib.error
from datetime import datetime

def handler(event, context):
    """
    Fetch real-time market data using Yahoo Finance API
    No external dependencies - uses only stdlib
    """
    print(f"Market Data Lambda Event: {json.dumps(event)}")
    
    try:
        tickers = event.get('tickers', [])
        
        if not tickers or not isinstance(tickers, list):
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'Invalid tickers array provided'})
            }
        
        quotes = {}
        sectors = {}
        betas = {}
        
        # Fetch data for each ticker using Yahoo Finance API
        for ticker in tickers:
            try:
                print(f"Fetching data for {ticker}...")
                
                # Get quote data
                quote_url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d"
                req = urllib.request.Request(quote_url, headers={
                    'User-Agent': 'Mozilla/5.0'
                })
                
                with urllib.request.urlopen(req, timeout=10) as response:
                    data = json.loads(response.read().decode())
                    
                if data.get('chart') and data['chart'].get('result'):
                    result = data['chart']['result'][0]
                    meta = result.get('meta', {})
                    
                    current_price = meta.get('regularMarketPrice', 0)
                    previous_close = meta.get('previousClose', current_price)
                    
                    change = current_price - previous_close
                    change_percent = (change / previous_close * 100) if previous_close > 0 else 0
                    
                    quotes[ticker] = {
                        'price': round(float(current_price), 2),
                        'change': round(float(change), 2),
                        'changePercent': round(float(change_percent), 2)
                    }
                    
                    print(f"Successfully fetched {ticker}: ${current_price}")
                else:
                    raise Exception("No data in response")
                
                # Get company info for sector and beta
                info_url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{ticker}?modules=assetProfile,defaultKeyStatistics"
                req2 = urllib.request.Request(info_url, headers={
                    'User-Agent': 'Mozilla/5.0'
                })
                
                try:
                    with urllib.request.urlopen(req2, timeout=10) as response:
                        info_data = json.loads(response.read().decode())
                        
                    if info_data.get('quoteSummary') and info_data['quoteSummary'].get('result'):
                        result = info_data['quoteSummary']['result'][0]
                        
                        # Get sector
                        if 'assetProfile' in result and 'sector' in result['assetProfile']:
                            sectors[ticker] = result['assetProfile']['sector']
                        else:
                            sectors[ticker] = 'Unknown'
                        
                        # Get beta
                        if 'defaultKeyStatistics' in result and 'beta' in result['defaultKeyStatistics']:
                            beta_raw = result['defaultKeyStatistics']['beta']
                            betas[ticker] = float(beta_raw.get('raw', 1.0)) if isinstance(beta_raw, dict) else float(beta_raw) if beta_raw else 1.0
                        else:
                            betas[ticker] = 1.0
                except Exception as e:
                    print(f"Could not fetch detailed info for {ticker}: {str(e)}")
                    sectors[ticker] = 'Unknown'
                    betas[ticker] = 1.0
                    
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
        
        print(f"Market data fetched successfully")
        
        return {
            'statusCode': 200,
            'body': json.dumps(response_data)
        }
        
    except Exception as error:
        print(f"Error in market data handler: {str(error)}")
        import traceback
        traceback.print_exc()
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': 'Failed to fetch market data',
                'message': str(error)
            })
        }