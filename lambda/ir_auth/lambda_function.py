import json
import urllib.request
import urllib.parse
import urllib.error
import boto3
import hashlib
import base64
import time
import logging
import os
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

# Configure structured logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.client('dynamodb')
secrets_client = boto3.client('secretsmanager')

# Constants
OAUTH_TOKEN_URL = "https://oauth.iracing.com/oauth2/token"
ACCESS_TOKEN_LIFETIME = 600  # 10 minutes
REFRESH_TOKEN_LIFETIME = 7 * 24 * 60 * 60  # 7 days
MAX_RETRIES = 3
BASE_BACKOFF_DELAY = 1  # seconds

class AuthenticationError(Exception):
    """Custom exception for authentication failures"""
    pass

class RateLimitError(Exception):
    """Custom exception for rate limiting"""
    pass

def get_oauth_credentials() -> Dict[str, str]:
    """
    Retrieve OAuth credentials from Secrets Manager
    
    Returns:
        Dict containing client_id, client_secret, username, password
        
    Raises:
        ClientError: If secret retrieval fails
    """
    try:
        secret_name = os.environ.get('IRACING_SECRET_NAME', 'iracing-oauth-credentials')
        response = secrets_client.get_secret_value(SecretId=secret_name)
        credentials = json.loads(response['SecretString'])
        
        required_keys = ['client_id', 'client_secret', 'username', 'password']
        for key in required_keys:
            if key not in credentials:
                raise ValueError(f"Missing required credential: {key}")
                
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

def normalize_string(value: str) -> str:
    """
    Normalize string for masking (lowercase and strip whitespace)
    
    Args:
        value: String to normalize
        
    Returns:
        Normalized string
    """
    return value.lower().strip()

def mask_client_secret(client_secret: str, client_id: str) -> str:
    """
    Mask client secret using SHA-256(client_secret + normalized_client_id) -> Base64
    
    Args:
        client_secret: The client secret to mask
        client_id: The client ID to use for masking
        
    Returns:
        Base64 encoded masked client secret
    """
    normalized_client_id = normalize_string(client_id)
    combined = client_secret + normalized_client_id
    hash_bytes = hashlib.sha256(combined.encode('utf-8')).digest()
    return base64.b64encode(hash_bytes).decode('utf-8')

def mask_password(password: str, username: str) -> str:
    """
    Mask password using SHA-256(password + normalized_username) -> Base64
    
    Args:
        password: The password to mask
        username: The username to use for masking
        
    Returns:
        Base64 encoded masked password
    """
    normalized_username = normalize_string(username)
    combined = password + normalized_username
    hash_bytes = hashlib.sha256(combined.encode('utf-8')).digest()
    return base64.b64encode(hash_bytes).decode('utf-8')

def make_oauth_request(credentials: Dict[str, str], grant_type: str = "password_limited", 
                      refresh_token: Optional[str] = None) -> Dict[str, Any]:
    """
    Make OAuth 2.1 request to iRacing API with exponential backoff
    
    Args:
        credentials: OAuth credentials dictionary
        grant_type: OAuth grant type (password_limited or refresh_token)
        refresh_token: Refresh token for token renewal
        
    Returns:
        OAuth response dictionary
        
    Raises:
        AuthenticationError: If authentication fails
        RateLimitError: If rate limited
    """
    if grant_type == "password_limited":
        data = {
            'grant_type': 'password_limited',
            'client_id': credentials['client_id'],
            'client_secret': mask_client_secret(credentials['client_secret'], credentials['client_id']),
            'username': credentials['username'],
            'password': mask_password(credentials['password'], credentials['username']),
            'scope': 'iracing.auth'
        }
    elif grant_type == "refresh_token":
        if not refresh_token:
            raise ValueError("Refresh token required for refresh_token grant")
        data = {
            'grant_type': 'refresh_token',
            'client_id': credentials['client_id'],
            'client_secret': mask_client_secret(credentials['client_secret'], credentials['client_id']),
            'refresh_token': refresh_token
        }
    else:
        raise ValueError(f"Unsupported grant type: {grant_type}")
    
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'iRacing-Lambda-Auth/1.0'
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            logger.info(f"Making OAuth request (attempt {attempt + 1}/{MAX_RETRIES})")
            logger.info(f"Grant type: {grant_type}")
            logger.info(f"Client ID: {data['client_id']}")
            logger.info(f"Username: {data.get('username', 'N/A')}")
            
            # Encode the data for POST request
            data_encoded = urllib.parse.urlencode(data).encode('utf-8')
            
            # Create request
            req = urllib.request.Request(
                OAUTH_TOKEN_URL,
                data=data_encoded,
                headers=headers
            )
            
            logger.info(f"Making request to: {OAUTH_TOKEN_URL}")
            logger.info(f"Request headers: {headers}")
            
            try:
                with urllib.request.urlopen(req, timeout=30) as response:
                    logger.info(f"Response status: {response.status}")
                    if response.status == 200:
                        logger.info("OAuth request successful")
                        response_data = json.loads(response.read().decode('utf-8'))
                        return response_data
                    elif response.status == 429:
                        # Rate limited
                        retry_after = int(response.headers.get('Retry-After', BASE_BACKOFF_DELAY * (2 ** attempt)))
                        logger.warning(f"Rate limited, waiting {retry_after} seconds")
                        if attempt < MAX_RETRIES - 1:
                            time.sleep(retry_after)
                            continue
                        else:
                            raise RateLimitError(f"Rate limited after {MAX_RETRIES} attempts")
                    elif response.status in [401, 403]:
                        logger.error(f"Authentication failed: {response.status}")
                        raise AuthenticationError(f"Authentication failed: {response.status}")
                    else:
                        logger.error(f"OAuth request failed: {response.status}")
                        if attempt < MAX_RETRIES - 1:
                            backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                            logger.info(f"Retrying in {backoff_delay} seconds")
                            time.sleep(backoff_delay)
                            continue
                        else:
                            raise AuthenticationError(f"OAuth request failed after {MAX_RETRIES} attempts")
                            
            except urllib.error.HTTPError as e:
                logger.error(f"HTTP Error: {e.code} - {e.reason}")
                # Try to read error response
                try:
                    error_body = e.read().decode('utf-8')
                    logger.error(f"Error response body: {error_body}")
                except:
                    logger.error("Could not read error response body")
                    
                if e.code == 429:
                    # Rate limited
                    retry_after = int(e.headers.get('Retry-After', BASE_BACKOFF_DELAY * (2 ** attempt)))
                    logger.warning(f"Rate limited, waiting {retry_after} seconds")
                    if attempt < MAX_RETRIES - 1:
                        time.sleep(retry_after)
                        continue
                    else:
                        raise RateLimitError(f"Rate limited after {MAX_RETRIES} attempts")
                elif e.code in [401, 403]:
                    logger.error(f"Authentication failed: {e.code}")
                    raise AuthenticationError(f"Authentication failed: {e.code}")
                else:
                    logger.error(f"OAuth request failed: {e.code}")
                    if attempt < MAX_RETRIES - 1:
                        backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                        logger.info(f"Retrying in {backoff_delay} seconds")
                        time.sleep(backoff_delay)
                        continue
                    else:
                        raise AuthenticationError(f"OAuth request failed after {MAX_RETRIES} attempts")
                        
        except urllib.error.URLError as e:
            logger.error(f"URL error on attempt {attempt + 1}: {e}")
            if attempt < MAX_RETRIES - 1:
                backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                logger.info(f"Retrying in {backoff_delay} seconds")
                time.sleep(backoff_delay)
                continue
            else:
                raise AuthenticationError(f"Request failed after {MAX_RETRIES} attempts: {e}")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON response on attempt {attempt + 1}: {e}")
            if attempt < MAX_RETRIES - 1:
                backoff_delay = BASE_BACKOFF_DELAY * (2 ** attempt)
                logger.info(f"Retrying in {backoff_delay} seconds")
                time.sleep(backoff_delay)
                continue
            else:
                raise AuthenticationError(f"Invalid JSON response after {MAX_RETRIES} attempts: {e}")
    
    raise AuthenticationError("Max retries exceeded")

def store_tokens_in_dynamodb(username: str, oauth_response: Dict[str, Any]) -> None:
    """
    Store OAuth tokens in DynamoDB with TTL
    
    Args:
        username: Username to use as partition key
        oauth_response: OAuth response containing tokens
    """
    current_time = int(time.time())
    access_token_ttl = current_time + oauth_response.get('expires_in', ACCESS_TOKEN_LIFETIME)
    refresh_token_ttl = current_time + oauth_response.get('refresh_token_expires_in', REFRESH_TOKEN_LIFETIME)
    
    item = {
        'username': {'S': username},
        'access_token': {'S': oauth_response['access_token']},
        'token_type': {'S': oauth_response.get('token_type', 'Bearer')},
        'expires_in': {'N': str(oauth_response.get('expires_in', ACCESS_TOKEN_LIFETIME))},
        'scope': {'S': oauth_response.get('scope', 'iracing.auth')},
        'ttl': {'N': str(access_token_ttl)}
    }
    
    if 'refresh_token' in oauth_response:
        item['refresh_token'] = {'S': oauth_response['refresh_token']}
        item['refresh_token_expires_in'] = {'N': str(oauth_response.get('refresh_token_expires_in', REFRESH_TOKEN_LIFETIME))}
        item['refresh_token_ttl'] = {'N': str(refresh_token_ttl)}
    
    try:
        table_name = os.environ.get('IR_AUTH_TABLE_NAME', 'ir_auth')
        response = dynamodb.put_item(TableName=table_name, Item=item)
        logger.info(f"Successfully stored tokens for user {username}")
        
    except ClientError as e:
        logger.error(f"Failed to store tokens in DynamoDB: {e}")
        raise

def get_existing_tokens(username: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve existing tokens from DynamoDB
    
    Args:
        username: Username to lookup
        
    Returns:
        Token data if found, None otherwise
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
                logger.info(f"Found valid access token for user {username}")
                return {
                    'access_token': item['access_token']['S'],
                    'token_type': item.get('token_type', {}).get('S', 'Bearer'),
                    'expires_in': int(item.get('expires_in', {}).get('N', '0')),
                    'scope': item.get('scope', {}).get('S', ''),
                    'refresh_token': item.get('refresh_token', {}).get('S'),
                    'refresh_token_expires_in': int(item.get('refresh_token_expires_in', {}).get('N', '0'))
                }
            else:
                logger.info(f"Access token expired for user {username}")
                # Check if refresh token is still valid
                refresh_token_ttl = int(item.get('refresh_token_ttl', {}).get('N', '0'))
                if refresh_token_ttl > current_time and 'refresh_token' in item:
                    logger.info(f"Refresh token still valid for user {username}")
                    return {
                        'refresh_token': item['refresh_token']['S'],
                        'expired': True
                    }
        
        logger.info(f"No valid tokens found for user {username}")
        return None
        
    except ClientError as e:
        logger.error(f"Failed to retrieve tokens from DynamoDB: {e}")
        return None

def lambda_handler(event, context):
    """
    Lambda handler for OAuth 2.1 authentication with iRacing API
    
    Args:
        event: Lambda event object
        context: Lambda context object
        
    Returns:
        HTTP response with authentication status
    """
    try:
        logger.info("Starting OAuth 2.1 authentication process")
        
        # Get OAuth credentials from Secrets Manager
        credentials = get_oauth_credentials()
        username = credentials['username']
        
        # Check for existing valid tokens
        existing_tokens = get_existing_tokens(username)
        
        if existing_tokens and not existing_tokens.get('expired'):
            # Return existing valid tokens
            logger.info("Returning existing valid tokens")
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json'
                },
                'body': json.dumps({
                    'message': 'Authentication successful (cached)',
                    'access_token': existing_tokens['access_token'],
                    'token_type': existing_tokens['token_type'],
                    'expires_in': existing_tokens['expires_in'],
                    'scope': existing_tokens['scope']
                })
            }
        
        # Try to refresh token if available
        if existing_tokens and existing_tokens.get('expired') and existing_tokens.get('refresh_token'):
            try:
                logger.info("Attempting to refresh access token")
                oauth_response = make_oauth_request(credentials, 'refresh_token', existing_tokens['refresh_token'])
                store_tokens_in_dynamodb(username, oauth_response)
                
                return {
                    'statusCode': 200,
                    'headers': {
                        'Content-Type': 'application/json'
                    },
                    'body': json.dumps({
                        'message': 'Authentication successful (refreshed)',
                        'access_token': oauth_response['access_token'],
                        'token_type': oauth_response.get('token_type', 'Bearer'),
                        'expires_in': oauth_response.get('expires_in', ACCESS_TOKEN_LIFETIME),
                        'scope': oauth_response.get('scope', 'iracing.auth')
                    })
                }
                
            except (AuthenticationError, RateLimitError) as e:
                logger.warning(f"Token refresh failed, falling back to password authentication: {e}")
        
        # Perform new authentication using password_limited_flow
        logger.info("Performing new OAuth 2.1 password_limited authentication")
        oauth_response = make_oauth_request(credentials, 'password_limited')
        
        # Store tokens in DynamoDB
        store_tokens_in_dynamodb(username, oauth_response)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json'
            },
            'body': json.dumps({
                'message': 'Authentication successful',
                'access_token': oauth_response['access_token'],
                'token_type': oauth_response.get('token_type', 'Bearer'),
                'expires_in': oauth_response.get('expires_in', ACCESS_TOKEN_LIFETIME),
                'scope': oauth_response.get('scope', 'iracing.auth')
            })
        }
        
    except AuthenticationError as e:
        logger.error(f"Authentication error: {e}")
        return {
            'statusCode': 401,
            'headers': {
                'Content-Type': 'application/json'
            },
            'body': json.dumps({
                'error': 'Authentication failed',
                'message': str(e)
            })
        }
        
    except RateLimitError as e:
        logger.error(f"Rate limit error: {e}")
        return {
            'statusCode': 429,
            'headers': {
                'Content-Type': 'application/json',
                'Retry-After': '60'
            },
            'body': json.dumps({
                'error': 'Rate limited',
                'message': str(e)
            })
        }
        
    except ClientError as e:
        logger.error(f"AWS service error: {e}")
        return {
            'statusCode': 503,
            'headers': {
                'Content-Type': 'application/json'
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
                'Content-Type': 'application/json'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': 'An unexpected error occurred'
            })
        }

