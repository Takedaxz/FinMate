#!/bin/bash

# FinMate AI Portfolio Advisor - Deployment Script
# AWS AI Agent Global Hackathon

set -e

echo "🚀 FinMate AI Portfolio Advisor - Deployment Script"
echo "=================================================="

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm and try again."
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install AWS CLI and try again."
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Please run 'aws configure' and try again."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    echo "🔑 Loading environment variables from .env file..."
    export $(grep -v '^#' .env | xargs)
else
    echo "ℹ️  No .env file found. Checking global environment variables."
fi

# Check environment variables
echo "🔧 Checking environment variables..."

if [ -z "$ALPHA_VANTAGE_API_KEY" ]; then
    echo "⚠️  ALPHA_VANTAGE_API_KEY not set. You can get a free API key from https://www.alphavantage.co/support/#api-key"
    echo "   Set it with: export ALPHA_VANTAGE_API_KEY='your_key_here'"
    read -p "Do you want to continue without market data? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

if [ -z "$CDK_DEFAULT_ACCOUNT" ]; then
    echo "📝 Setting CDK_DEFAULT_ACCOUNT from AWS CLI..."
    export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
fi

if [ -z "$CDK_DEFAULT_REGION" ]; then
    echo "📝 Setting CDK_DEFAULT_REGION to us-east-1..."
    export CDK_DEFAULT_REGION="us-east-1"
fi

echo "✅ Environment variables configured"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

echo "📦 Installing Lambda dependencies..."
cd lambda && npm install && cd ..

# Build the project
echo "🔨 Building the project..."
npm run build

# Bootstrap CDK (if needed)
echo "🚀 Bootstrapping CDK (if needed)..."
npx cdk bootstrap

# Deploy the stack
echo "🚀 Deploying FinMate stack..."
npx cdk deploy --require-approval never

# Get outputs
echo "📊 Getting deployment outputs..."
API_URL=$(aws cloudformation describe-stacks --stack-name FinMateStack --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text)
BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name FinMateStack --query 'Stacks[0].Outputs[?OutputKey==`PortfolioBucket`].OutputValue' --output text)

echo ""
echo "🎉 Deployment completed successfully!"
echo "=================================="
echo ""
echo "📊 API Gateway URL: $API_URL"
echo "🪣 S3 Bucket: $BUCKET_NAME"
echo ""
echo "🌐 Web UI: Open web/index.html in your browser"
echo "   (Update the apiBaseUrl in the HTML file with the API Gateway URL above)"
echo ""
echo "📁 Sample Portfolio: Upload sample-portfolio.csv to test the system"
echo ""
echo "🔧 To test the API:"
echo "   curl -X POST $API_URL/portfolio -F 'file=@sample-portfolio.csv'"
echo ""
echo "⚠️  Remember to set your Alpha Vantage API key in the Lambda environment variables:"
echo "   aws lambda update-function-configuration --function-name FinMateStack-MarketDataFunction-XXXXX --environment Variables='{ALPHA_VANTAGE_API_KEY=your_key_here}'"
echo ""
echo "📚 See README.md for detailed usage instructions"
echo ""
echo "🎯 Happy analyzing! 🚀"
