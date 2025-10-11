# FinMate Architecture

## System Overview

```mermaid
graph TB
    subgraph "Client Layer"
        UI[Web UI]
        API_CLIENT[API Client]
    end
    
    subgraph "AWS API Gateway"
        GW[API Gateway]
    end
    
    subgraph "AWS Lambda Functions"
        APP[Main App Lambda]
        MARKET[Market Data Lambda]
        METRICS[Compute Metrics Lambda]
        REPORT[Write Report Lambda]
    end
    
    subgraph "AWS Bedrock"
        BEDROCK[Claude 3 Sonnet]
    end
    
    subgraph "AWS S3"
        PORTFOLIOS[Portfolio Storage]
        REPORTS[Report Storage]
        CACHE[Market Data Cache]
    end
    
    subgraph "External APIs"
        ALPHA[Alpha Vantage API]
    end
    
    subgraph "AWS EventBridge"
        SCHEDULER[Daily Check Scheduler]
    end
    
    UI --> GW
    API_CLIENT --> GW
    GW --> APP
    
    APP --> MARKET
    APP --> METRICS
    APP --> REPORT
    APP --> BEDROCK
    
    MARKET --> ALPHA
    MARKET --> CACHE
    
    METRICS --> PORTFOLIOS
    REPORT --> REPORTS
    
    SCHEDULER --> APP
    
    PORTFOLIOS --> APP
    CACHE --> MARKET
```

## Data Flow

### 1. Portfolio Upload & Analysis
```
User → Web UI → API Gateway → Main App Lambda
                                    ↓
                            Save to S3 (Portfolio Storage)
                                    ↓
                            Invoke Market Data Lambda
                                    ↓
                            Fetch from Alpha Vantage API
                                    ↓
                            Cache in S3
                                    ↓
                            Invoke Compute Metrics Lambda
                                    ↓
                            Calculate portfolio metrics
                                    ↓
                            Send to Bedrock for AI analysis
                                    ↓
                            Invoke Write Report Lambda
                                    ↓
                            Generate HTML/Markdown report
                                    ↓
                            Save to S3 (Report Storage)
                                    ↓
                            Return analysis results to user
```

### 2. Autonomous Daily Check
```
EventBridge Scheduler → Main App Lambda
                              ↓
                      Load user portfolios from S3
                              ↓
                      Run analysis (same flow as above)
                              ↓
                      Generate daily summary report
                              ↓
                      Store in S3
```

## Component Details

### AWS Services Used

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **API Gateway** | REST API endpoints | CORS enabled, Lambda integration |
| **Lambda** | Serverless compute | Node.js 18, 5-15 min timeout |
| **S3** | File storage | SSE-S3 encryption, versioned |
| **Bedrock** | AI reasoning | Claude 3 Sonnet model |
| **EventBridge** | Scheduling | Daily cron at 9 AM UTC |
| **IAM** | Access control | Least-privilege roles |

### Lambda Functions

#### Main App Lambda (`app.ts`)
- **Purpose**: Orchestrates the entire analysis workflow
- **Triggers**: API Gateway, EventBridge
- **Actions**: 
  - Portfolio upload/retrieval
  - Coordinates tool invocations
  - Generates AI analysis via Bedrock
  - Returns formatted results

#### Market Data Lambda (`market-data.ts`)
- **Purpose**: Fetches real-time market data
- **External API**: Alpha Vantage (free tier)
- **Features**: 
  - Rate limiting (5 calls/minute)
  - S3 caching (15-minute TTL)
  - Error handling with fallbacks

#### Compute Metrics Lambda (`compute-metrics.ts`)
- **Purpose**: Calculates portfolio analytics
- **Calculations**:
  - Position weights and P&L
  - Sector exposure analysis
  - Risk flag identification
  - Portfolio beta calculation

#### Write Report Lambda (`write-report.ts`)
- **Purpose**: Generates formatted reports
- **Outputs**: HTML and Markdown formats
- **Features**:
  - Responsive design
  - Interactive charts
  - Pre-signed URLs for access

## Security & Compliance

### Data Protection
- **Encryption**: S3 server-side encryption (SSE-S3)
- **Access Control**: IAM roles with least privilege
- **API Security**: CORS configuration, input validation
- **No PII**: Demo data only, no personal information

### Cost Optimization
- **Lambda**: Pay-per-request pricing
- **Bedrock**: Optimized prompts to minimize tokens
- **S3**: Minimal storage with lifecycle policies
- **Caching**: Reduces external API calls

## Scalability Considerations

### Current Limitations (MVP)
- 100 tickers per analysis
- Single currency (USD)
- Basic error handling
- No user authentication

### Future Enhancements
- Horizontal scaling with Lambda concurrency
- Multi-currency support
- Advanced caching strategies
- User management and authentication
- Real-time streaming updates

## Monitoring & Observability

### Logging
- CloudWatch Logs for all Lambda functions
- Structured logging with correlation IDs
- Error tracking and alerting

### Metrics
- API Gateway request/response metrics
- Lambda duration and error rates
- S3 storage and request metrics
- Bedrock token usage and costs

## Deployment Architecture

### Infrastructure as Code
- **CDK**: TypeScript-based infrastructure
- **Stack**: Single stack with all resources
- **Environment**: Development/Production separation
- **CI/CD**: Manual deployment via scripts

### Environment Variables
```bash
ALPHA_VANTAGE_API_KEY=your_api_key
BUCKET_NAME=finmate-portfolios-account-region
MARKET_DATA_FUNCTION=function_name
COMPUTE_METRICS_FUNCTION=function_name
WRITE_REPORT_FUNCTION=function_name
```

## API Design

### RESTful Endpoints
```
POST /portfolio              # Upload portfolio
GET  /portfolio?id=X         # Get portfolio
POST /portfolio/analyze      # Analyze portfolio
GET  /report?user_id=X       # Get latest report
POST /simulate/rebalance     # Simulate rebalancing
```

### Request/Response Formats
- **Upload**: Multipart form data (CSV) or JSON
- **Analysis**: JSON with portfolio_id and risk preferences
- **Response**: JSON with summary, recommendations, and report URL

## Error Handling Strategy

### Graceful Degradation
- Market data failures → Use cached data or defaults
- AI analysis failures → Return basic metrics
- Report generation failures → Return JSON summary
- Network timeouts → Retry with exponential backoff

### User Experience
- Clear error messages
- Fallback recommendations
- Progress indicators
- Retry mechanisms
