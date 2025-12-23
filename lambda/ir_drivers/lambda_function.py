import json
import urllib.request
import urllib.parse
import urllib.error
import boto3
import logging
import os
import time
from typing import Dict, Any, Optional, List
from botocore.exceptions import ClientError

# Configure structured logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.client('dynamodb')
lambda_client = boto3.client('lambda')
secrets_client = boto3.client('secretsmanager')

# Constants
MAX_RETRIES = 3
BASE_BACKOFF_DELAY = 1  # seconds
CACHE_TTL_SECONDS = 3600  # 1 hour

class AuthenticationError(Exception):
    """Custom exception for authentication failures"""
    pass

class APIError(Exception):
    """Custom exception for iRacing API failures"""
    pass

def get_oauth_credentials() -> Dict[str, str]:
    """
    Retrieve OAuth credentials from Secrets Manager
    
    Returns:
        Dict containing username for token lookup
        
    Raises:
        ClientError: If secret retrieval fails
    """
    try:
        secret_name = os.environ.get('IRACING_SECRET_NAME', 'iracing-oauth-credentials')
        response = secrets_client.get_secret_value(SecretId=secret_name)
        credentials = json.loads(response['SecretString'])
        
        if 'username' not in credentials:
            raise ValueError("Missing required credential: username")
                
        logger.info("Successfully retrieved OAuth credentials from Secrets Manager")
        return credentials
        
    except ClientError as e:
        logger.error(f"Failed to retrieve credentials from Secrets Manager: {e}")
        raise
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in secret: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error retrieving credentials: {e}")
        raise

def get_access_token(username: str) -> Optional[str]:
    """
    Retrieve valid access token from DynamoDB
    
    Args:
        username: Username to lookup tokens for
        
    Returns:
        Access token if valid, None otherwise
    """
    try:
        table_name = os.environ.get('IR_AUTH_TABLE_NAME', 'ir_auth')
        response = dynamodb.get_item(
            TableName=table_name,
            Key={'username': {'S': username}}
        )
        
        if 'Item' in response:
            item = response['Item']
            current_time = int(time.time())
            
            # Check if access token is still valid
            ttl = int(item.get('ttl', {}).get('N', '0'))
            if ttl > current_time:
                access_token = item['access_token']['S']
                logger.info(f"Found valid access token for user {username}")
                return access_token
            else:
                logger.info(f"Access token expired for user {username}")
        
        logger.info(f"No valid access token found for user {username}")
        return None
        
    except ClientError as e:
        logger.error(f"Failed to retrieve access token from DynamoDB: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error retrieving access token: {e}")
        return None

def invoke_auth_lambda() -> None:
    """
    Invoke ir_auth Lambda function to refresh authentication
    
    Raises:
        AuthenticationError: If authentication fails
    """
    try:
        logger.info("Invoking ir_auth Lambda for token refresh")
        response = lambda_client.invoke(
            FunctionName=os.environ.get('IR_AUTH_FUNCTION_ARN', 'ir_auth'),
            InvocationType='RequestResponse',
            Payload=json.dumps({})
        )
        
        if response['StatusCode'] != 200:
            raise AuthenticationError(f"ir_auth Lambda returned status {response['StatusCode']}")
            
        payload = json.loads(response['Payload'].read())
        if payload.get('statusCode') != 200:
            raise AuthenticationError(f"ir_auth Lambda failed: {payload.get('body', 'Unknown error')}")
            
        logger.info("Successfully invoked ir_auth Lambda")
        
    except ClientError as e:
        logger.error(f"Failed to invoke ir_auth Lambda: {e}")
        raise AuthenticationError(f"Failed to invoke authentication: {e}")
    except Exception as e:
        logger.error(f"Unexpected error invoking ir_auth Lambda: {e}")
        raise AuthenticationError(f"Authentication invocation failed: {e}")

def invoke_custid_lambda(driver_name: str) -> Optional[str]:
    """
    Invoke ir_custid Lambda function to get customer ID
    
    Args:
        driver_name: Name of driver to lookup
        
    Returns:
        Customer ID if found, None otherwise
        
    Raises:
        APIError: If invocation fails
    """
    try:
        logger.info(f"Invoking ir_custid Lambda for driver: {driver_name}")
        payload = {"rawQueryString": driver_name}
        response = lambda_client.invoke(
            FunctionName=os.environ.get('IR_CUSTID_FUNCTION_ARN', 'ir_custid'),
            InvocationType='RequestResponse',
            Payload=json.dumps(payload)
        )
        
        if response['StatusCode'] != 200:
            raise APIError(f"ir_custid Lambda returned status {response['StatusCode']}")
            
        response_payload = json.loads(response['Payload'].read())
        if response_payload.get('statusCode') != 200:
            raise APIError(f"ir_custid Lambda failed: {response_payload.get('body', 'Unknown error')}")
            
        body = json.loads(response_payload['body'])
        custid = body.get('custid', '0')
        
        logger.info(f"Successfully got customer ID for {driver_name}: {custid}")
        return custid
        
    except ClientError as e:
        logger.error(f"Failed to invoke ir_custid Lambda: {e}")
        raise APIError(f"Failed to invoke customer ID lookup: {e}")
    except Exception as e:
        logger.error(f"Unexpected error invoking ir_custid Lambda: {e}")
        raise APIError(f"Customer ID lookup failed: {e}")

def get_driver_profile_with_auth(cust_id: str, access_token: str) -> Dict[str, Any]:
    """
    Get driver profile using Bearer token authentication
    
    Args:
        cust_id: Customer ID to lookup
        access_token: OAuth access token
        
    Returns:
        Driver profile dictionary
        
    Raises:
        APIError: If API request fails
        AuthenticationError: If authentication fails
    """
    headers = {
        'Authorization': f'Bearer {access_token}',
        'User-Agent': 'iRacing-Lambda-Drivers/1.0',
        'Content-Type': 'application/json'
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            logger.info(f"Getting driver profile for customer ID {cust_id} (attempt {attempt + 1}/{MAX_RETRIES})")
            
            # First request to get the profile link
            profile_url = f"https://members-ng.iracing.com/data/member/profile?cust_id={cust_id}"
            
            # Create request with headers
            req = urllib.request.Request(profile_url, headers=headers)
            
            try:
                with urllib.request.urlopen(req, timeout=30) as response:
                    if response.status == 401:
                        logger.error("Authentication failed - token may be expired")
                        raise AuthenticationError("Access token expired or invalid")
                    elif response.status == 429:
                        logger.warning("Rate limited by iRacing API")
                        if attempt < MAX_RETRIES - 1:
                            backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                            logger.info(f"Retrying in {backoff_delay} seconds")
                            time.sleep(backoff_delay)
                            continue
                        else:
                            raise APIError("Rate limited after maximum retries")
                    elif response.status != 200:
                        logger.error(f"Profile request failed: {response.status}")
                        if attempt < MAX_RETRIES - 1:
                            backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                            logger.info(f"Retrying in {backoff_delay} seconds")
                            time.sleep(backoff_delay)
                            continue
                        else:
                            raise APIError(f"Profile request failed: {response.status}")
                    
                    profile_data = json.loads(response.read().decode('utf-8'))
                    
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    logger.error("Authentication failed - token may be expired")
                    raise AuthenticationError("Access token expired or invalid")
                elif e.code == 429:
                    logger.warning("Rate limited by iRacing API")
                    if attempt < MAX_RETRIES - 1:
                        backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                        logger.info(f"Retrying in {backoff_delay} seconds")
                        time.sleep(backoff_delay)
                        continue
                    else:
                        raise APIError("Rate limited after maximum retries")
                else:
                    logger.error(f"Profile request failed: {e.code}")
                    if attempt < MAX_RETRIES - 1:
                        backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                        logger.info(f"Retrying in {backoff_delay} seconds")
                        time.sleep(backoff_delay)
                        continue
                    else:
                        raise APIError(f"Profile request failed: {e.code}")
            
            if 'link' not in profile_data:
                logger.error("No link found in profile response")
                raise APIError("Invalid profile response format")
            
            # Second request to get the actual profile data
            profile_detail_url = profile_data['link']
            # S3 URLs don't need Authorization header - they use signed URL authentication
            s3_headers = {
                'User-Agent': 'iRacing-Lambda-Drivers/1.0',
                'Content-Type': 'application/json'
            }
            detail_req = urllib.request.Request(profile_detail_url, headers=s3_headers)
            
            try:
                with urllib.request.urlopen(detail_req, timeout=30) as response:
                    if response.status == 401:
                        logger.error("Authentication failed on profile detail request")
                        raise AuthenticationError("Access token expired or invalid")
                    elif response.status != 200:
                        logger.error(f"Profile detail request failed: {response.status}")
                        if attempt < MAX_RETRIES - 1:
                            backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                            logger.info(f"Retrying in {backoff_delay} seconds")
                            time.sleep(backoff_delay)
                            continue
                        else:
                            raise APIError(f"Profile detail request failed: {response.status}")
                    
                    driver_profile = json.loads(response.read().decode('utf-8'))
                    logger.info(f"Successfully retrieved profile for customer ID {cust_id}")
                    return driver_profile
                    
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    logger.error("Authentication failed on profile detail request")
                    raise AuthenticationError("Access token expired or invalid")
                else:
                    logger.error(f"Profile detail request failed: {e.code}")
                    if attempt < MAX_RETRIES - 1:
                        backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                        logger.info(f"Retrying in {backoff_delay} seconds")
                        time.sleep(backoff_delay)
                        continue
                    else:
                        raise APIError(f"Profile detail request failed: {e.code}")
            
        except urllib.error.URLError as e:
            logger.error(f"URL error on attempt {attempt + 1}: {e}")
            if attempt < MAX_RETRIES - 1:
                backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                logger.info(f"Retrying in {backoff_delay} seconds")
                time.sleep(backoff_delay)
                continue
            else:
                raise APIError(f"Request failed after {MAX_RETRIES} attempts: {e}")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON response on attempt {attempt + 1}: {e}")
            if attempt < MAX_RETRIES - 1:
                backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                logger.info(f"Retrying in {backoff_delay} seconds")
                time.sleep(backoff_delay)
                continue
            else:
                raise APIError(f"Invalid JSON response after {MAX_RETRIES} attempts: {e}")
    
    raise APIError("Max retries exceeded")

def cache_driver_profile(name: str, profile: Dict[str, Any]) -> None:
    """
    Cache driver profile in DynamoDB with TTL
    
    Args:
        name: Driver name
        profile: Driver profile data
    """
    try:
        current_time = int(time.time())
        ttl = current_time + CACHE_TTL_SECONDS
        
        table_name = os.environ.get('IR_DRIVERS_TABLE_NAME', 'ir_drivers')
        response = dynamodb.put_item(
            TableName=table_name,
            Item={
                'name': {'S': str(name)},
                'profile': {'S': json.dumps(profile)},
                'ttl': {'N': str(ttl)}
            }
        )
        logger.info(f"Cached driver profile: {name} (TTL: {ttl})")
        
    except ClientError as e:
        logger.error(f"Failed to cache driver profile: {e}")
        # Don't raise - caching failure shouldn't break the main flow

def get_cached_driver_profile(name: str) -> Optional[Dict[str, Any]]:
    """
    Get cached driver profile from DynamoDB
    
    Args:
        name: Driver name to lookup
        
    Returns:
        Cached profile if found and valid, None otherwise
    """
    try:
        table_name = os.environ.get('IR_DRIVERS_TABLE_NAME', 'ir_drivers')
        response = dynamodb.get_item(
            TableName=table_name,
            Key={'name': {'S': str(name)}}
        )
        
        if 'Item' in response:
            # TTL is handled automatically by DynamoDB, but we can check manually too
            current_time = int(time.time())
            ttl = int(response['Item'].get('ttl', {}).get('N', '0'))
            
            if ttl > current_time:
                profile_json = response['Item']['profile']['S']
                profile = json.loads(profile_json)
                logger.info(f"Found cached profile for driver: {name}")
                return profile
            else:
                logger.info(f"Cached profile expired for driver: {name}")
        
        return None
        
    except ClientError as e:
        logger.error(f"Failed to get cached driver profile: {e}")
        return None
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in cached profile: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error getting cached profile: {e}")
        return None

def get_customer_id_from_cache(name: str) -> Optional[str]:
    """
    Get customer ID from cache
    
    Args:
        name: Driver name to lookup
        
    Returns:
        Customer ID if found, None otherwise
    """
    try:
        table_name = os.environ.get('IR_CUSTID_TABLE_NAME', 'ir_custid')
        response = dynamodb.get_item(
            TableName=table_name,
            Key={'name': {'S': name}}
        )
        
        if 'Item' in response:
            custid = response['Item']['cust_id']['N']
            logger.info(f"Found cached customer ID for {name}: {custid}")
            return custid
        
        return None
        
    except ClientError as e:
        logger.error(f"Failed to get cached customer ID: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error getting cached customer ID: {e}")
        return None

def process_driver(name: str, username: str, access_token: str) -> Dict[str, Any]:
    """
    Process a single driver - get profile with caching
    
    Args:
        name: Driver name
        username: OAuth username for token lookup
        access_token: OAuth access token
        
    Returns:
        Driver profile data or error message
    """
    try:
        # Check cache first
        cached_profile = get_cached_driver_profile(name)
        if cached_profile:
            return cached_profile
        
        # Get customer ID from cache or via ir_custid Lambda
        cust_id = get_customer_id_from_cache(name)
        if not cust_id:
            cust_id = invoke_custid_lambda(name)
        
        if not cust_id or int(cust_id) <= 0:
            logger.warning(f"No valid customer ID found for driver: {name}")
            return {"error": f"Driver not found: {name}"}
        
        # Get driver profile with authentication retry logic
        try:
            profile = get_driver_profile_with_auth(cust_id, access_token)
            cache_driver_profile(name, profile)
            return profile
            
        except AuthenticationError:
            logger.info(f"Authentication failed for {name}, retrying with fresh token")
            # Token might have expired, try refreshing
            invoke_auth_lambda()
            new_access_token = get_access_token(username)
            
            if not new_access_token:
                raise AuthenticationError("Failed to obtain access token after re-authentication")
            
            profile = get_driver_profile_with_auth(cust_id, new_access_token)
            cache_driver_profile(name, profile)
            return profile
            
    except (APIError, AuthenticationError) as e:
        logger.error(f"Failed to process driver {name}: {e}")
        return {"error": f"iRacing API error for {name}: {str(e)}"}
    except Exception as e:
        logger.error(f"Unexpected error processing driver {name}: {e}")
        return {"error": f"Unexpected error for {name}: {str(e)}"}

def lambda_handler(event, context):
    """
    Lambda handler for driver profile lookup with OAuth Bearer token authentication
    
    Args:
        event: Lambda event object
        context: Lambda context object
        
    Returns:
        HTTP response with driver profile information
    """
    try:
        logger.info("Starting driver profile lookup process")
        
        # Get drivers from query string
        drivers = []
        try:
            if 'queryStringParameters' in event and event['queryStringParameters']:
                names_param = event['queryStringParameters'].get('names', '')
                drivers = urllib.parse.unquote(names_param).split(',')
                drivers = [name.strip() for name in drivers if name.strip()]
            
            if not drivers:
                logger.error("No driver names provided")
                return {
                    'statusCode': 400,
                    'headers': {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET'
                    },
                    'body': json.dumps({
                        'error': 'Bad Request',
                        'message': 'Driver names are required in query parameter "names"'
                    })
                }
                
        except Exception as e:
            logger.error(f"Error parsing query parameters: {e}")
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET'
                },
                'body': json.dumps({
                    'error': 'Bad Request',
                    'message': 'Invalid query parameters'
                })
            }
        
        logger.info(f"Processing {len(drivers)} drivers: {drivers}")
        
        # Get OAuth credentials to determine username
        credentials = get_oauth_credentials()
        username = credentials['username']
        
        # Get access token
        access_token = get_access_token(username)
        
        if not access_token:
            logger.info("No valid access token found, invoking ir_auth Lambda")
            invoke_auth_lambda()
            # Retry getting access token after authentication
            access_token = get_access_token(username)
            
            if not access_token:
                raise AuthenticationError("Failed to obtain access token after authentication")
        
        # Process each driver
        drivers_info = {}
        for name in drivers:
            logger.info(f"Processing driver: {name}")
            drivers_info[name] = process_driver(name, username, access_token)
        
        logger.info(f"Successfully processed {len(drivers_info)} drivers")
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET'
            },
            'body': json.dumps(drivers_info)
        }
        
    except AuthenticationError as e:
        logger.error(f"Authentication error: {e}")
        return {
            'statusCode': 401,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET'
            },
            'body': json.dumps({
                'error': 'Authentication failed',
                'message': str(e)
            })
        }
        
    except APIError as e:
        logger.error(f"API error: {e}")
        return {
            'statusCode': 502,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET'
            },
            'body': json.dumps({
                'error': 'API error',
                'message': str(e)
            })
        }
        
    except ClientError as e:
        logger.error(f"AWS service error: {e}")
        return {
            'statusCode': 503,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET'
            },
            'body': json.dumps({
                'error': 'Service unavailable',
                'message': 'AWS service temporarily unavailable'
            })
        }
        
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': 'An unexpected error occurred'
            })
        }


