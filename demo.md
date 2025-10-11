# FinMate Demo Guide

## 🎯 Demo Overview (3 minutes)

This demo showcases FinMate's core capabilities as an autonomous AI portfolio advisor built for the AWS AI Agent Global Hackathon.

## 🚀 Demo Flow

### 1. Portfolio Upload (30 seconds)
- **Action**: Upload `sample-portfolio.csv` via web UI
- **Show**: 
  - Drag & drop interface
  - CSV parsing and validation
  - Detected tickers and positions
- **Result**: Portfolio ID generated and stored in S3

### 2. AI Analysis (60 seconds)
- **Action**: Click "Analyze Portfolio"
- **Show**:
  - Real-time market data fetching
  - Portfolio metrics calculation
  - AI reasoning via Bedrock
- **Result**: 
  - Portfolio summary with P&L
  - Risk flags and sector exposure
  - AI-generated recommendations

### 3. Report Generation (30 seconds)
- **Action**: View detailed report
- **Show**:
  - HTML report with charts
  - Professional formatting
  - Downloadable link
- **Result**: Complete portfolio analysis report

### 4. Autonomous Operation (30 seconds)
- **Action**: Trigger daily check manually
- **Show**:
  - EventBridge scheduling
  - Autonomous analysis without user input
  - Daily summary generation
- **Result**: Automated portfolio monitoring

### 5. API Integration (30 seconds)
- **Action**: Show API endpoints
- **Show**:
  - RESTful API design
  - JSON request/response
  - Integration capabilities
- **Result**: Developer-friendly API

## 🎬 Demo Script

### Opening (15 seconds)
"Welcome to FinMate, an autonomous AI portfolio advisor built for the AWS AI Agent Global Hackathon. FinMate uses reasoning-first LLMs to analyze portfolios, explain risks, and propose actionable rebalancing suggestions."

### Portfolio Upload (30 seconds)
"Let's start by uploading a sample portfolio. I'll drag and drop this CSV file containing 8 positions across major tech stocks. Notice how FinMate automatically detects the tickers and validates the data structure."

### AI Analysis (60 seconds)
"Now I'll trigger the AI analysis. Behind the scenes, FinMate is:
- Fetching real-time market data from Alpha Vantage
- Calculating portfolio metrics like weights and P&L
- Using Amazon Bedrock's Claude 3 Sonnet for reasoning
- Generating personalized recommendations

The AI has identified several risk flags and is suggesting diversification strategies based on the portfolio's current sector concentration."

### Report Generation (30 seconds)
"FinMate generates a comprehensive HTML report with interactive charts and professional formatting. The report includes portfolio metrics, sector exposure, risk analysis, and actionable recommendations - all with proper disclaimers."

### Autonomous Operation (30 seconds)
"One of FinMate's key features is autonomous operation. I can trigger the daily check manually to show how it runs without user input, analyzing the portfolio and generating a summary report automatically."

### Technical Highlights (15 seconds)
"FinMate demonstrates all hackathon requirements:
- LLM hosted on AWS Bedrock
- Bedrock AgentCore for tool orchestration
- Autonomous capabilities with EventBridge scheduling
- External API integration for market data
- Serverless architecture with Lambda and S3"

## 🔧 Demo Setup

### Prerequisites
1. Deploy the infrastructure: `./deploy.sh`
2. Set Alpha Vantage API key
3. Open web UI in browser
4. Have `sample-portfolio.csv` ready

### Demo Environment
```bash
# Set API URL in web UI
const apiBaseUrl = 'https://your-api-gateway-url.amazonaws.com/prod';

# Or use local testing
const apiBaseUrl = 'http://localhost:3000';
```

### Sample Data
The `sample-portfolio.csv` contains:
- 8 tech stocks (AAPL, MSFT, NVDA, GOOGL, TSLA, AMZN, META, NFLX)
- Realistic position sizes and cost basis
- Recent acquisition dates

## 🎯 Key Messages

### For Judges
1. **AWS-Native**: Built entirely on AWS services
2. **Reasoning-First**: Uses LLM reasoning, not prediction models
3. **Autonomous**: Runs without user prompts via EventBridge
4. **Production-Ready**: Proper error handling and security
5. **Cost-Effective**: Serverless architecture under $50/month

### For Users
1. **Transparent**: Clear explanations for all recommendations
2. **Educational**: Learn about portfolio diversification
3. **Actionable**: Specific steps to improve portfolio health
4. **Safe**: Includes proper disclaimers and risk warnings

## 🚨 Demo Troubleshooting

### Common Issues
1. **API Key Missing**: Set `ALPHA_VANTAGE_API_KEY` environment variable
2. **CORS Errors**: Check API Gateway CORS configuration
3. **Lambda Timeouts**: Increase timeout for market data function
4. **Rate Limits**: Alpha Vantage free tier has 5 calls/minute limit

### Fallback Options
1. **No Market Data**: Use cached data or mock responses
2. **AI Analysis Fails**: Return basic metrics and recommendations
3. **Report Generation Fails**: Return JSON summary
4. **Network Issues**: Show cached results or error messages

## 📊 Expected Results

### Portfolio Analysis
- **Total Value**: ~$50,000 (varies with market prices)
- **P&L**: Positive or negative based on current market
- **Beta**: ~1.2-1.5 (tech-heavy portfolio)
- **Risk Flags**: 2-3 concentration warnings

### AI Recommendations
1. **Diversification**: Reduce tech sector concentration
2. **Position Sizing**: Trim largest positions
3. **Risk Management**: Add defensive stocks or bonds

### Report Features
- Interactive HTML with charts
- Mobile-responsive design
- Professional formatting
- Downloadable PDF option

## 🎉 Demo Conclusion

"FinMate demonstrates how AWS AI services can create intelligent, autonomous financial advisors that provide transparent, educational guidance. The system combines real-time market data with AI reasoning to deliver actionable insights while maintaining proper disclaimers and risk management."

## 📝 Post-Demo Q&A

### Technical Questions
- **Architecture**: Serverless, event-driven design
- **Scalability**: Lambda auto-scaling, S3 for storage
- **Security**: IAM roles, S3 encryption, input validation
- **Cost**: Under $50/month for MVP usage

### Business Questions
- **Market**: Retail investors seeking transparent guidance
- **Differentiation**: Reasoning-first approach vs. prediction models
- **Monetization**: Freemium model with premium features
- **Compliance**: Educational disclaimers, no trading execution

### Future Roadmap
- Brokerage integration for paper trading
- Advanced risk models (VaR, Monte Carlo)
- Multi-currency and tax optimization
- Mobile app and real-time alerts
