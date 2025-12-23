# Configuration Files

This directory contains configuration files for the iRacing Forum Browser Addon Drivers Stats project.

## Secrets Configuration

### secrets.json (Not in version control)

This file contains your iRacing OAuth 2.1 credentials and is automatically used by the deployment script to populate AWS Secrets Manager.

**Setup:**
1. Copy the template: `cp secrets.template.json secrets.json`
2. Edit `secrets.json` with your actual credentials
3. Deploy with secrets: `./scripts/deploy.sh --update-secrets`

**Format:**
```json
{
  "client_id": "your_iracing_client_id",
  "client_secret": "your_iracing_client_secret",
  "username": "your_email@example.com", 
  "password": "your_password"
}
```

### secrets.template.json

Template file showing the required structure for the secrets configuration. This file is safe to commit to version control as it contains no actual credentials.

## Security Notes

⚠️ **IMPORTANT SECURITY CONSIDERATIONS:**

1. **Never commit secrets.json to version control**
   - The file is already in .gitignore
   - Contains sensitive authentication credentials
   - Could compromise your iRacing account if exposed

2. **File permissions**
   ```bash
   # Restrict access to secrets file
   chmod 600 config/secrets.json
   ```

3. **Environment-specific secrets**
   - Use different credentials for different environments if possible
   - Production should use dedicated service account credentials
   - Development can use personal credentials for testing

4. **Credential rotation**
   - Regularly rotate your iRacing credentials
   - Update the secrets.json file and redeploy with `--update-secrets`
   - Monitor AWS CloudTrail for unauthorized access

## Usage Examples

### Basic deployment with secrets
```bash
# Deploy to development with automatic secrets configuration
./scripts/deploy.sh -e dev --update-secrets

# Deploy to production with secrets
./scripts/deploy.sh -e prod --update-secrets
```

### Custom secrets file
```bash
# Use a different secrets file
./scripts/deploy.sh --update-secrets --secrets-file config/prod-secrets.json
```

### Update secrets only
```bash
# Update secrets without full deployment
aws secretsmanager update-secret \
  --secret-id "iRacing/OAuth/Credentials-dev" \
  --secret-string file://config/secrets.json
```

## Troubleshooting

### Invalid JSON format
```bash
# Validate JSON format
jq empty config/secrets.json
```

### Missing required fields
Ensure all required fields are present:
- `client_id`: Your iRacing application client ID
- `client_secret`: Your iRacing application client secret  
- `username`: Your iRacing account email
- `password`: Your iRacing account password

### Secrets Manager permissions
Ensure your AWS credentials have permission to:
- `secretsmanager:CreateSecret`
- `secretsmanager:UpdateSecret`
- `secretsmanager:DescribeSecret`

## Environment Variables

You can also use environment variables instead of the secrets file:

```bash
export IRACING_CLIENT_ID="your_client_id"
export IRACING_CLIENT_SECRET="your_client_secret"
export IRACING_USERNAME="your_email@example.com"
export IRACING_PASSWORD="your_password"

# Deploy script will check for these if secrets.json doesn't exist
./scripts/deploy.sh --update-secrets
```

## Best Practices

1. **Use dedicated service accounts for production**
   - Create separate iRacing accounts for production use
   - Use strong, unique passwords
   - Enable two-factor authentication where possible

2. **Implement credential rotation**
   - Rotate credentials regularly (quarterly recommended)
   - Use AWS Secrets Manager automatic rotation if available
   - Monitor for credential usage and anomalies

3. **Audit access**
   - Monitor AWS CloudTrail for Secrets Manager access
   - Set up alerts for unusual access patterns
   - Regular security reviews of IAM permissions

4. **Backup and recovery**
   - Keep secure backups of credentials
   - Document recovery procedures
   - Test credential recovery process

## Related Documentation

- [Deployment Guide](../docs/DEPLOYMENT.md) - Complete deployment procedures
- [Troubleshooting Guide](../docs/TROUBLESHOOTING.md) - Common issues and solutions
- [Rollback Procedures](../docs/ROLLBACK.md) - Rollback and recovery procedures