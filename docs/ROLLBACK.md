# Rollback Procedures

This document provides detailed procedures for rolling back the iRacing Forum Browser Addon Drivers Stats deployment in case of issues during or after deployment.

## Rollback Scenarios

### Scenario 1: CDK Deployment Failure
**When:** CDK deployment fails during stack creation/update
**Impact:** New infrastructure not created, existing infrastructure unaffected
**Action:** No rollback needed, fix issues and retry deployment

### Scenario 2: Post-Deployment Functional Issues
**When:** Deployment succeeds but Lambda functions don't work correctly
**Impact:** New infrastructure exists but is non-functional
**Action:** Rollback to previous infrastructure

### Scenario 3: Performance Degradation
**When:** New infrastructure performs poorly compared to old system
**Impact:** Service degradation affecting users
**Action:** Immediate rollback to previous infrastructure

### Scenario 4: Data Corruption/Loss
**When:** Deployment causes data issues in DynamoDB
**Impact:** Critical data loss or corruption
**Action:** Emergency rollback with data restoration

## Rollback Decision Matrix

| Issue Severity | Time Since Deployment | Rollback Method |
|---------------|----------------------|-----------------|
| Critical (Service Down) | < 1 hour | Immediate CDK Rollback |
| Critical (Service Down) | > 1 hour | Manual Infrastructure Restoration |
| High (Degraded Performance) | < 4 hours | CDK Rollback |
| High (Degraded Performance) | > 4 hours | Planned Rollback |
| Medium (Minor Issues) | Any | Fix Forward or Planned Rollback |

## Rollback Procedures

### Method 1: CDK Stack Rollback (Preferred)

**Prerequisites:**
- CDK deployment was successful initially
- CloudFormation stack exists and is in a stable state
- Rollback is initiated within reasonable time frame

**Steps:**

1. **Immediate Rollback Using CDK**
   ```bash
   cd cdk-infrastructure
   
   # Check current stack status
   aws cloudformation describe-stacks --stack-name CdkInfrastructureStack-prod
   
   # Rollback to previous version
   aws cloudformation cancel-update-stack --stack-name CdkInfrastructureStack-prod
   
   # If cancel doesn't work, continue update rollback
   aws cloudformation continue-update-rollback --stack-name CdkInfrastructureStack-prod
   ```

2. **Monitor Rollback Progress**
   ```bash
   # Watch rollback progress
   aws cloudformation describe-stack-events --stack-name CdkInfrastructureStack-prod
   
   # Check final status
   aws cloudformation describe-stacks --stack-name CdkInfrastructureStack-prod --query 'Stacks[0].StackStatus'
   ```

3. **Verify Rollback Success**
   - Check that Lambda functions are restored
   - Verify API Gateway endpoints are working
   - Confirm DynamoDB tables are accessible
   - Test basic functionality

### Method 2: Manual Infrastructure Restoration

**When to Use:**
- CDK rollback is not possible
- Stack is in an inconsistent state
- Need to restore to a previous CDK deployment state

**Prerequisites:**
- Previous CDK deployment configuration
- CloudFormation stack backup
- Lambda function code backup

**Steps:**

1. **Restore from Previous CDK Deployment**
   ```bash
   # Rollback to previous CDK deployment using git
   git checkout <previous-commit-hash>
   
   # Redeploy previous version
   ./scripts/deploy.sh -e prod --force
   ```

2. **Restore from CloudFormation Backup**
   ```bash
   # If you have a CloudFormation template backup
   aws cloudformation create-stack \
     --stack-name CdkInfrastructureStack-prod-rollback \
     --template-body file://backup-template.yaml \
     --capabilities CAPABILITY_IAM
   ```

3. **Restore DynamoDB Tables** (If needed)
   ```bash
   # Restore from backup if tables were modified
   aws dynamodb restore-table-from-backup \
     --target-table-name ir_auth \
     --backup-arn arn:aws:dynamodb:REGION:ACCOUNT:table/ir_auth/backup/BACKUP_NAME
   ```

### Method 3: Emergency Data Restoration

**When to Use:**
- Data corruption or loss detected
- Critical business data affected
- Immediate restoration required

**Steps:**

1. **Stop All Traffic**
   ```bash
   # Disable API Gateway endpoints
   aws apigateway update-stage \
     --rest-api-id API_ID \
     --stage-name prod \
     --patch-ops op=replace,path=/throttle/rateLimit,value=0
   ```

2. **Restore Data from Backups**
   ```bash
   # Restore DynamoDB tables from point-in-time recovery
   aws dynamodb restore-table-to-point-in-time \
     --source-table-name ir_custid \
     --target-table-name ir_custid_restored \
     --restore-date-time 2024-01-01T12:00:00.000Z
   ```

3. **Validate Data Integrity**
   ```bash
   # Compare record counts
   aws dynamodb describe-table --table-name ir_custid_restored --query 'Table.ItemCount'
   
   # Sample data validation
   aws dynamodb scan --table-name ir_custid_restored --max-items 10
   ```

4. **Switch to Restored Tables**
   ```bash
   # Update Lambda environment variables to point to restored tables
   aws lambda update-function-configuration \
     --function-name ir-custid \
     --environment Variables='{"TABLE_NAME":"ir_custid_restored"}'
   ```

## Rollback Validation

### Functional Validation Checklist
- [ ] Authentication endpoints respond correctly
- [ ] Customer ID lookup returns expected results
- [ ] Driver profile retrieval works
- [ ] Response times are acceptable
- [ ] Error handling functions properly

### Data Validation Checklist
- [ ] No data loss in critical tables
- [ ] Data integrity maintained
- [ ] Cached data is consistent
- [ ] TTL settings are correct

### Performance Validation Checklist
- [ ] Response times meet SLA requirements
- [ ] Concurrent request handling works
- [ ] Memory usage is within limits
- [ ] No timeout issues

## Post-Rollback Actions

### Immediate Actions (0-1 hour)
1. **Notify Stakeholders**
   - Inform development team of rollback
   - Update incident tracking system
   - Communicate status to users if needed

2. **Monitor System Health**
   - Check CloudWatch metrics
   - Monitor error rates
   - Verify user traffic patterns

3. **Document Issues**
   - Record what went wrong
   - Capture error messages and logs
   - Note timeline of events

### Short-term Actions (1-24 hours)
1. **Root Cause Analysis**
   - Analyze deployment logs
   - Review configuration differences
   - Identify specific failure points

2. **Fix Planning**
   - Determine fixes needed
   - Plan testing approach
   - Schedule next deployment attempt

3. **Communication**
   - Send post-incident report
   - Update documentation
   - Share lessons learned

### Long-term Actions (1-7 days)
1. **Process Improvement**
   - Update deployment procedures
   - Enhance testing protocols
   - Improve monitoring and alerting

2. **Documentation Updates**
   - Update deployment procedures
   - Revise rollback procedures
   - Create troubleshooting guides

## Rollback Testing

### Pre-Production Testing
Test rollback procedures in development/staging environments:

```bash
# Deploy test version
./scripts/deploy.sh -e staging

# Simulate failure and rollback
aws cloudformation cancel-update-stack --stack-name CdkInfrastructureStack-staging

# Validate rollback success
./scripts/validate-deployment.sh -e staging
```

### Rollback Drills
Conduct regular rollback drills to ensure procedures work:
- Monthly rollback simulation in staging
- Quarterly full rollback drill
- Annual disaster recovery exercise

## Emergency Contacts

### Escalation Path
1. **Level 1:** Development Team Lead
2. **Level 2:** DevOps/Infrastructure Team
3. **Level 3:** Engineering Manager
4. **Level 4:** CTO/Technical Director

### Contact Information
- **Development Team:** dev-team@company.com
- **DevOps Team:** devops@company.com
- **On-Call Engineer:** +1-XXX-XXX-XXXX
- **Emergency Escalation:** emergency@company.com

## Rollback Metrics and SLAs

### Target Rollback Times
- **Critical Issues:** < 15 minutes
- **High Priority Issues:** < 1 hour
- **Medium Priority Issues:** < 4 hours

### Success Criteria
- System functionality restored to pre-deployment state
- No additional data loss during rollback
- All monitoring and alerting functional
- User impact minimized

## Prevention Strategies

### Deployment Best Practices
- Always deploy to staging first
- Perform thorough testing before production
- Use feature flags for gradual rollouts
- Implement comprehensive monitoring

### Monitoring and Alerting
- Set up alerts for key metrics
- Monitor error rates and response times
- Track business metrics during deployment
- Implement automated health checks

### Testing Strategies
- Automated integration tests
- Load testing before production deployment
- Canary deployments for high-risk changes
- Regular disaster recovery testing