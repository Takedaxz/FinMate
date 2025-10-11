import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({});

interface ReportData {
  portfolio_metrics: any;
  analysis_summary: string;
  recommendations: Array<{
    action: string;
    rationale: string;
    impact: string;
  }>;
  user_id: string;
  generated_at: string;
}

export const handler = async (event: any) => {
  console.log('Write Report Lambda Event:', JSON.stringify(event, null, 2));

  try {
    const reportData = event as ReportData;
    
    if (!reportData.portfolio_metrics || !reportData.user_id) {
      throw new Error('Portfolio metrics and user_id are required');
    }

    const reportId = uuidv4();
    const reportHtml = generateReportHtml(reportData);
    const reportMarkdown = generateReportMarkdown(reportData);

    // Upload HTML report
    const htmlKey = `reports/${reportData.user_id}/${reportData.generated_at}/summary.html`;
    await uploadReport(htmlKey, reportHtml, 'text/html');

    // Upload Markdown report
    const mdKey = `reports/${reportData.user_id}/${reportData.generated_at}/summary.md`;
    await uploadReport(mdKey, reportMarkdown, 'text/markdown');

    // Generate pre-signed URL for HTML report (valid for 24 hours)
    const reportUrl = await generatePresignedUrl(htmlKey);

    return {
      statusCode: 200,
      body: JSON.stringify({
        report_id: reportId,
        report_url: reportUrl,
        html_key: htmlKey,
        markdown_key: mdKey,
        generated_at: reportData.generated_at,
      }),
    };
  } catch (error) {
    console.error('Error in write report handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to generate report',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

function generateReportHtml(data: ReportData): string {
  const { portfolio_metrics, analysis_summary, recommendations } = data;
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FinMate Portfolio Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8f9fa;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
        }
        .header p {
            margin: 10px 0 0 0;
            opacity: 0.9;
        }
        .card {
            background: white;
            border-radius: 10px;
            padding: 25px;
            margin-bottom: 25px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .metric {
            text-align: center;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            color: #667eea;
        }
        .metric-label {
            color: #666;
            margin-top: 5px;
        }
        .positive { color: #28a745; }
        .negative { color: #dc3545; }
        .neutral { color: #6c757d; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
        }
        .recommendation {
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
            padding: 15px;
            margin: 10px 0;
            border-radius: 4px;
        }
        .risk-flag {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 10px 0;
            border-radius: 4px;
        }
        .disclaimer {
            background: #f8d7da;
            border-left: 4px solid #dc3545;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
            font-weight: bold;
        }
        .sector-chart {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 15px;
        }
        .sector-item {
            background: #667eea;
            color: white;
            padding: 8px 15px;
            border-radius: 20px;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 FinMate Portfolio Report</h1>
        <p>Generated on ${new Date(data.generated_at).toLocaleDateString()} at ${new Date(data.generated_at).toLocaleTimeString()}</p>
    </div>

    <div class="card">
        <h2>📈 Portfolio Overview</h2>
        <div class="metrics-grid">
            <div class="metric">
                <div class="metric-value">$${portfolio_metrics.total_value.toLocaleString(undefined, {maximumFractionDigits: 0})}</div>
                <div class="metric-label">Total Value</div>
            </div>
            <div class="metric">
                <div class="metric-value ${portfolio_metrics.total_pnl >= 0 ? 'positive' : 'negative'}">
                    ${portfolio_metrics.total_pnl >= 0 ? '+' : ''}$${portfolio_metrics.total_pnl.toLocaleString(undefined, {maximumFractionDigits: 0})}
                </div>
                <div class="metric-label">Total P&L</div>
            </div>
            <div class="metric">
                <div class="metric-value ${portfolio_metrics.total_pnl_percent >= 0 ? 'positive' : 'negative'}">
                    ${portfolio_metrics.total_pnl_percent >= 0 ? '+' : ''}${portfolio_metrics.total_pnl_percent.toFixed(2)}%
                </div>
                <div class="metric-label">P&L %</div>
            </div>
            <div class="metric">
                <div class="metric-value">${portfolio_metrics.portfolio_beta.toFixed(2)}</div>
                <div class="metric-label">Portfolio Beta</div>
            </div>
        </div>
    </div>

    <div class="card">
        <h2>🏢 Sector Exposure</h2>
        <div class="sector-chart">
            ${Object.entries(portfolio_metrics.sector_exposure)
              .sort(([,a], [,b]) => (b as number) - (a as number))
              .map(([sector, exposure]) => 
                `<div class="sector-item">${sector}: ${(exposure as number).toFixed(1)}%</div>`
              ).join('')}
        </div>
    </div>

    <div class="card">
        <h2>📊 Top Holdings</h2>
        <table>
            <thead>
                <tr>
                    <th>Ticker</th>
                    <th>Weight</th>
                    <th>Sector</th>
                    <th>Current Value</th>
                    <th>P&L</th>
                    <th>P&L %</th>
                </tr>
            </thead>
            <tbody>
                ${portfolio_metrics.top_concentrations.map((pos: any) => `
                    <tr>
                        <td><strong>${pos.ticker}</strong></td>
                        <td>${pos.weight.toFixed(1)}%</td>
                        <td>${pos.sector}</td>
                        <td>$${portfolio_metrics.positions.find((p: any) => p.ticker === pos.ticker)?.current_value.toLocaleString() || 'N/A'}</td>
                        <td class="${portfolio_metrics.positions.find((p: any) => p.ticker === pos.ticker)?.pnl >= 0 ? 'positive' : 'negative'}">
                            ${portfolio_metrics.positions.find((p: any) => p.ticker === pos.ticker)?.pnl >= 0 ? '+' : ''}
                            $${portfolio_metrics.positions.find((p: any) => p.ticker === pos.ticker)?.pnl.toLocaleString() || 'N/A'}
                        </td>
                        <td class="${portfolio_metrics.positions.find((p: any) => p.ticker === pos.ticker)?.pnl_percent >= 0 ? 'positive' : 'negative'}">
                            ${portfolio_metrics.positions.find((p: any) => p.ticker === pos.ticker)?.pnl_percent >= 0 ? '+' : ''}
                            ${portfolio_metrics.positions.find((p: any) => p.ticker === pos.ticker)?.pnl_percent.toFixed(2) || 'N/A'}%
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    ${portfolio_metrics.risk_flags.length > 0 ? `
    <div class="card">
        <h2>⚠️ Risk Flags</h2>
        ${portfolio_metrics.risk_flags.map((flag: string) => `
            <div class="risk-flag">${flag}</div>
        `).join('')}
    </div>
    ` : ''}

    <div class="card">
        <h2>🤖 AI Analysis</h2>
        <p>${analysis_summary}</p>
    </div>

    ${recommendations.length > 0 ? `
    <div class="card">
        <h2>💡 Recommendations</h2>
        ${recommendations.map((rec: any) => `
            <div class="recommendation">
                <h4>${rec.action}</h4>
                <p><strong>Rationale:</strong> ${rec.rationale}</p>
                <p><strong>Expected Impact:</strong> ${rec.impact}</p>
            </div>
        `).join('')}
    </div>
    ` : ''}

    <div class="disclaimer">
        ⚠️ <strong>DISCLAIMER:</strong> This is not financial advice. All recommendations are for educational purposes only. 
        Please consult with a qualified financial advisor before making investment decisions.
    </div>
</body>
</html>`;
}

function generateReportMarkdown(data: ReportData): string {
  const { portfolio_metrics, analysis_summary, recommendations } = data;
  
  return `# FinMate Portfolio Report

**Generated:** ${new Date(data.generated_at).toLocaleString()}

## Portfolio Overview

- **Total Value:** $${portfolio_metrics.total_value.toLocaleString()}
- **Total P&L:** $${portfolio_metrics.total_pnl.toLocaleString()} (${portfolio_metrics.total_pnl_percent.toFixed(2)}%)
- **Portfolio Beta:** ${portfolio_metrics.portfolio_beta.toFixed(2)}

## Sector Exposure

${Object.entries(portfolio_metrics.sector_exposure)
  .sort(([,a], [,b]) => (b as number) - (a as number))
  .map(([sector, exposure]) => `- **${sector}:** ${(exposure as number).toFixed(1)}%`)
  .join('\n')}

## Top Holdings

| Ticker | Weight | Sector | Current Value | P&L | P&L % |
|--------|--------|--------|---------------|-----|-------|
${portfolio_metrics.top_concentrations.map((pos: any) => {
  const position = portfolio_metrics.positions.find((p: any) => p.ticker === pos.ticker);
  return `| ${pos.ticker} | ${pos.weight.toFixed(1)}% | ${pos.sector} | $${position?.current_value.toLocaleString() || 'N/A'} | $${position?.pnl.toLocaleString() || 'N/A'} | ${position?.pnl_percent.toFixed(2) || 'N/A'}% |`;
}).join('\n')}

${portfolio_metrics.risk_flags.length > 0 ? `
## ⚠️ Risk Flags

${portfolio_metrics.risk_flags.map((flag: string) => `- ${flag}`).join('\n')}
` : ''}

## AI Analysis

${analysis_summary}

${recommendations.length > 0 ? `
## 💡 Recommendations

${recommendations.map((rec: any) => `
### ${rec.action}

**Rationale:** ${rec.rationale}

**Expected Impact:** ${rec.impact}
`).join('\n')}
` : ''}

---

**⚠️ DISCLAIMER:** This is not financial advice. All recommendations are for educational purposes only. Please consult with a qualified financial advisor before making investment decisions.
`;
}

async function uploadReport(key: string, content: string, contentType: string): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME!,
    Key: key,
    Body: content,
    ContentType: contentType,
  });
  
  await s3Client.send(command);
}

async function generatePresignedUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME!,
    Key: key,
  });
  // 24 hours
  return await getSignedUrl(s3Client, command, { expiresIn: 60 * 60 * 24 });
}
