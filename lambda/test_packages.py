import sys
import os
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
