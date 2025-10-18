import sys
import os
import json

def handler(event, context):
    result = {
        "python_version": sys.version,
        "python_path": sys.path[:3],  # First 3 paths to avoid too much output
    }

    packages = {}
    
    try:
        import pandas
        packages["pandas"] = pandas.__version__
    except ImportError as e:
        packages["pandas"] = f"not available: {str(e)}"

    try:
        import numpy
        packages["numpy"] = numpy.__version__
    except ImportError as e:
        packages["numpy"] = f"not available: {str(e)}"

    try:
        import yfinance
        packages["yfinance"] = yfinance.__version__
    except ImportError as e:
        packages["yfinance"] = f"not available: {str(e)}"
        # Try to see if the module exists in the filesystem
        import os
        if os.path.exists('/opt/python/yfinance'):
            packages["yfinance_path"] = "exists at /opt/python/yfinance"
            # List contents
            try:
                packages["yfinance_contents"] = os.listdir('/opt/python/yfinance')[:5]  # First 5 items
            except:
                packages["yfinance_contents"] = "cannot list"
        else:
            packages["yfinance_path"] = "not found at /opt/python/yfinance"

    try:
        import boto3
        packages["boto3"] = boto3.__version__
    except ImportError as e:
        packages["boto3"] = f"not available: {str(e)}"

    result["packages"] = packages
    
    return {
        'statusCode': 200,
        'body': json.dumps(result, indent=2)
    }

if __name__ == "__main__":
    print("Python version:", sys.version)
    print("Python path:", sys.path)

    try:
        import pandas
        print("pandas available:", pandas.__version__)
    except ImportError as e:
        print("pandas not available:", e)

    try:
        import numpy
        print("numpy available:", numpy.__version__)
    except ImportError as e:
        print("numpy not available:", e)

    try:
        import yfinance
        print("yfinance available:", yfinance.__version__)
    except ImportError as e:
        print("yfinance not available:", e)

    try:
        import boto3
        print("boto3 available:", boto3.__version__)
    except ImportError as e:
        print("boto3 not available:", e)
