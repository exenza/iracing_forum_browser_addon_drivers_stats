import json
import urllib.request
import urllib.parse
import urllib.error
import boto3
import logging
import os
import time
from typing import Dict, Any, Optional
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

def search_driver_with_auth(search_term: str, access_token: str) -> Dict[str, Any]:
    """
    Search for driver using Bearer token authentication
    
    Args:
        search_term: Driver name to search for
        access_token: OAuth access token
        
    Returns:
        Driver information dictionary
        
    Raises:
        APIError: If API request fails
        AuthenticationError: If authentication fails
    """
    headers = {
        'Authorization': f'Bearer {access_token}',
        'User-Agent': 'iRacing-Lambda-Custid/1.0',
        'Content-Type': 'application/json'
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            logger.info(f"Searching for driver '{search_term}' (attempt {attempt + 1}/{MAX_RETRIES})")
            
            # First request to get the search link
            search_url = f"https://members-ng.iracing.com/data/lookup/drivers?search_term={urllib.parse.quote(search_term)}"
            req = urllib.request.Request(search_url, headers=headers)
            
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
                        logger.error(f"Search request failed: {response.status}")
                        if attempt < MAX_RETRIES - 1:
                            backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                            logger.info(f"Retrying in {backoff_delay} seconds")
                            time.sleep(backoff_delay)
                            continue
                        else:
                            raise APIError(f"Search request failed: {response.status}")
                    
                    search_data = json.loads(response.read().decode('utf-8'))
                    
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
                    logger.error(f"Search request failed: {e.code}")
                    if attempt < MAX_RETRIES - 1:
                        backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                        logger.info(f"Retrying in {backoff_delay} seconds")
                        time.sleep(backoff_delay)
                        continue
                    else:
                        raise APIError(f"Search request failed: {e.code}")
            
            if 'link' not in search_data:
                logger.error("No link found in search response")
                raise APIError("Invalid search response format")
            
            # Second request to get the actual driver data
            driver_url = search_data['link']
            # S3 URLs don't need Authorization header - they use signed URL authentication
            s3_headers = {
                'User-Agent': 'iRacing-Lambda-Custid/1.0',
                'Content-Type': 'application/json'
            }
            driver_req = urllib.request.Request(driver_url, headers=s3_headers)
            
            try:
                with urllib.request.urlopen(driver_req, timeout=30) as response:
                    if response.status == 401:
                        logger.error("Authentication failed on driver data request")
                        raise AuthenticationError("Access token expired or invalid")
                    elif response.status != 200:
                        logger.error(f"Driver data request failed: {response.status}")
                        if attempt < MAX_RETRIES - 1:
                            backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                            logger.info(f"Retrying in {backoff_delay} seconds")
                            time.sleep(backoff_delay)
                            continue
                        else:
                            raise APIError(f"Driver data request failed: {response.status}")
                    
                    drivers_data = json.loads(response.read().decode('utf-8'))
                    
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    logger.error("Authentication failed on driver data request")
                    raise AuthenticationError("Access token expired or invalid")
                else:
                    logger.error(f"Driver data request failed: {e.code}")
                    if attempt < MAX_RETRIES - 1:
                        backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                        logger.info(f"Retrying in {backoff_delay} seconds")
                        time.sleep(backoff_delay)
                        continue
                    else:
                        raise APIError(f"Driver data request failed: {e.code}")
            
            if not drivers_data:
                logger.info(f"No drivers found for search term: {search_term}")
                return {
                    'custid': 0,
                    'name': f'Not found: {search_term}',
                    'origin': 'iRacing'
                }
            
            # Handle multiple results - look for exact match first
            if len(drivers_data) > 1:
                for driver in drivers_data:
                    if driver.get('display_name') == search_term:
                        logger.info(f"Found exact match for '{search_term}': {driver['cust_id']}")
                        # Cache the result
                        cache_driver_result(driver['display_name'], driver['cust_id'])
                        return {
                            'custid': str(driver['cust_id']),
                            'name': str(driver['display_name']),
                            'origin': 'iRacing'
                        }
            
            # Use first result if no exact match
            driver = drivers_data[0]
            logger.info(f"Found driver for '{search_term}': {driver['display_name']} ({driver['cust_id']})")
            
            # Cache the result
            cache_driver_result(driver['display_name'], driver['cust_id'])
            
            return {
                'custid': str(driver['cust_id']),
                'name': str(driver['display_name']),
                'origin': 'iRacing'
            }
            
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

def cache_driver_result(name: str, cust_id: int) -> None:
    """
    Cache driver lookup result in DynamoDB
    
    Args:
        name: Driver display name
        cust_id: Driver customer ID
    """
    try:
        table_name = os.environ.get('IR_CUSTID_TABLE_NAME', 'ir_custid')
        response = dynamodb.put_item(
            TableName=table_name,
            Item={
                'name': {'S': str(name)},
                'cust_id': {'N': str(cust_id)}
            }
        )
        logger.info(f"Cached driver result: {name} -> {cust_id}")
        
    except ClientError as e:
        logger.error(f"Failed to cache driver result: {e}")
        # Don't raise - caching failure shouldn't break the main flow

def lambda_handler(event, context):
    """
    Lambda handler for customer ID lookup with OAuth Bearer token authentication
    
    Args:
        event: Lambda event object
        context: Lambda context object
        
    Returns:
        HTTP response with customer ID information
    """
    try:
        logger.info("Starting customer ID lookup process")
        
        # Get search term from query string
        search_term = urllib.parse.unquote(event.get('rawQueryString', ''))
        if not search_term:
            logger.error("No search term provided")
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'error': 'Bad Request',
                    'message': 'Search term is required'
                })
            }
        
        logger.info(f"Searching for driver: {search_term}")
        
        # Check cache first
        custid_table_name = os.environ.get('IR_CUSTID_TABLE_NAME', 'ir_custid')
        response = dynamodb.get_item(
            TableName=custid_table_name,
            Key={'name': {'S': search_term}}
        )
        
        if 'Item' in response:
            logger.info(f"Found cached result for '{search_term}'")
            custid = {
                'custid': response['Item']['cust_id']['N'],
                'name': search_term,
                'origin': 'DynamoDB'
            }
        else:
            logger.info(f"No cached result found for '{search_term}', querying iRacing API")
            
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
            
            # Search for driver using Bearer token
            try:
                custid = search_driver_with_auth(search_term, access_token)
            except AuthenticationError:
                logger.info("Authentication failed, retrying with fresh token")
                # Token might have expired, try refreshing
                invoke_auth_lambda()
                access_token = get_access_token(username)
                
                if not access_token:
                    raise AuthenticationError("Failed to obtain access token after re-authentication")
                
                custid = search_driver_with_auth(search_term, access_token)
        
        logger.info(f"Successfully found customer ID: {custid}")
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps(custid)
        }
        
    except AuthenticationError as e:
        logger.error(f"Authentication error: {e}")
        return {
            'statusCode': 401,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'Authentication failed',
                'message': str(e)
            })
        }
        
    except APIError as e:
        logger.error(f"API error: {e}")
        return {
            'statusCode': 502,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'API error',
                'message': str(e)
            })
        }
        
    except ClientError as e:
        logger.error(f"AWS service error: {e}")
        return {
            'statusCode': 503,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'Service unavailable',
                'message': 'AWS service temporarily unavailable'
            })
        }
        
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'Internal server error',
                'message': 'An unexpected error occurred'
            })
        }

