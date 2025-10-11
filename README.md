# FinMate - AI Portfolio Advisor

> **An AWS-native, reasoning-first personal finance agent** that analyzes stock portfolios, explains risks, and proposes actionable rebalancing suggestions. Built for the AWS AI Agent Global Hackathon.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- AWS CLI configured with appropriate permissions
- Alpha Vantage API key (free tier available)

### 1. Install Dependencies

```bash
npm install
cd lambda && npm install && cd ..
```

### 2. Set Environment Variables

```bash
export ALPHA_VANTAGE_API_KEY="your_api_key_here"
export CDK_DEFAULT_ACCOUNT="your_aws_account_id"
export CDK_DEFAULT_REGION="us-east-1"
```

### 3. Deploy Infrastructure

```bash
npm run build
npm run deploy
```

### 4. Test the Application

1. Open the web UI at the provided API Gateway URL
2. Upload the sample portfolio: `sample-portfolio.csv`
3. Click "Analyze Portfolio" to see AI-powered recommendations

## 🏗️ Architecture

```
[Web UI] → [API Gateway] → [Lambda App] → [Bedrock AgentCore]
                                    ↓
[Market Data Lambda] ← [External APIs] (Alpha Vantage)
[Compute Metrics Lambda] ← [Portfolio Data]
[Write Report Lambda] → [S3 Reports]
```

### Core Components

- **Amazon Bedrock**: Claude 3 Sonnet for AI reasoning
- **AWS Lambda**: Serverless compute for tools and orchestration
- **Amazon S3**: Portfolio storage and report generation
- **API Gateway**: RESTful API endpoints
- **EventBridge**: Scheduled daily portfolio checks

## 📊 Features

### MVP Capabilities

- ✅ **Portfolio Upload**: CSV or JSON format
- ✅ **Market Data Integration**: Real-time quotes via Alpha Vantage
- ✅ **AI Analysis**: Risk assessment and recommendations
- ✅ **Report Generation**: HTML/Markdown reports with charts
- ✅ **Autonomous Operation**: Daily scheduled portfolio checks
- ✅ **Web Interface**: Modern, responsive UI

### AI-Powered Insights

- Portfolio diversification analysis
- Sector exposure calculations
- Risk flag identification
- Position sizing recommendations
- Beta-weighted portfolio analysis

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/portfolio` | Upload portfolio (CSV/JSON) |
| GET | `/portfolio?portfolio_id=X` | Retrieve portfolio |
| POST | `/portfolio/analyze` | Analyze portfolio with AI |
| GET | `/report?user_id=X` | Get latest report |
| POST | `/simulate/rebalance` | Simulate rebalancing |

## 📁 Project Structure

```
├── bin/
│   └── finmate-app.ts          # CDK app entry point
├── lib/
│   └── finmate-stack.ts        # Infrastructure definition
├── lambda/
│   ├── app.ts                  # Main orchestration Lambda
│   ├── market-data.ts          # Market data tool
│   ├── compute-metrics.ts      # Portfolio calculations
│   └── write-report.ts         # Report generation
├── web/
│   └── index.html              # Web UI
├── sample-portfolio.csv        # Sample data
└── prd.md                      # Product requirements
```

## 🛠️ Development

### Local Testing

```bash
# Install AWS SAM CLI for local testing
npm install -g @aws-cdk/aws-lambda-nodejs
npm run build
```

### Adding New Tools

1. Create new Lambda function in `lambda/` directory
2. Add function to CDK stack in `lib/finmate-stack.ts`
3. Update main app Lambda to invoke new function
4. Add tool schema to Bedrock AgentCore configuration

## 🔐 Security & Compliance

- **Data Encryption**: S3 server-side encryption
- **IAM Roles**: Least-privilege access
- **API Security**: API Gateway with CORS
- **Disclaimer**: All outputs include financial advice disclaimer

## 💰 Cost Optimization

- **Lambda**: Pay-per-request pricing
- **Bedrock**: Token-based pricing (optimized prompts)
- **S3**: Minimal storage costs
- **API Gateway**: Request-based pricing

Estimated monthly cost for MVP: < $50

## 🚨 Limitations (MVP)

- No live trading execution
- Limited to 100 tickers per analysis
- Basic risk models (no Monte Carlo)
- Single currency (USD) support
- Demo data only (no PII handling)

## 🔮 Future Enhancements

- Brokerage integration (Alpaca paper trading)
- Advanced risk models (VaR, Monte Carlo)
- Multi-currency support
- Tax optimization
- Real-time alerts and notifications
- Mobile app

## 📝 Sample Usage

### 1. Upload Portfolio

```bash
curl -X POST https://your-api-url/portfolio \
  -H "Content-Type: multipart/form-data" \
  -F "file=@sample-portfolio.csv"
```

### 2. Analyze Portfolio

```bash
curl -X POST https://your-api-url/portfolio/analyze \
  -H "Content-Type: application/json" \
  -d '{"portfolio_id": "your-portfolio-id", "risk_prefs": {"risk": "medium"}}'
```

### 3. Get Report

```bash
curl https://your-api-url/report?user_id=demo-user
```

## 🤝 Contributing

This is a hackathon project. For production use, consider:

- Enhanced error handling
- Input validation
- Rate limiting
- Monitoring and logging
- Security hardening

## 📄 License

MIT License - See LICENSE file for details

## ⚠️ Disclaimer

**This is not financial advice.** All recommendations are for educational purposes only. Please consult with a qualified financial advisor before making investment decisions.

---

Built with ❤️ for the AWS AI Agent Global Hackathon
