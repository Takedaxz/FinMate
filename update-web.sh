#!/bin/bash

echo "🚀 Updating FinMate Web Application..."

# Update web files to S3
echo "📤 Uploading web files to S3..."
aws s3 cp web/ s3://finmate-web-417447013956-ap-southeast-1/ --recursive --region ap-southeast-1

echo "✅ Web update complete!"
echo "🌐 Your changes will be live at: https://d3qbbxwiavzwxh.cloudfront.net"
echo "⏱️  Changes appear within 1-2 minutes due to CloudFront caching"
