import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { DataStack } from '../lib/data-stack';
import { GithubCiStack } from '../lib/github-ci-stack';
import { WebCertStack } from '../lib/web-cert-stack';
import { WebStack } from '../lib/web-stack';

// One synth of every stack for sandbox (bundling the Lambdas once), shared by all tests.
const app = new cdk.App();
const env = { account: '975050268859', region: 'eu-west-2' };
const data = new DataStack(app, 'Data', { env, deployEnv: 'sandbox' });
const auth = new AuthStack(app, 'Auth', { env, deployEnv: 'sandbox' });
const api = new ApiStack(app, 'Api', {
  env,
  deployEnv: 'sandbox',
  version: '1.2.3',
  table: data.table,
  dataBucket: data.bucket,
  userPoolId: auth.userPoolId,
  userPoolClientId: auth.clientId,
});
const cert = new WebCertStack(app, 'Cert', {
  env: { ...env, region: 'us-east-1' },
  deployEnv: 'sandbox',
  crossRegionReferences: true,
});
const web = new WebStack(app, 'Web', {
  env,
  deployEnv: 'sandbox',
  certificate: cert.certificate,
  httpApi: api.httpApi,
  crossRegionReferences: true,
});
const ci = new GithubCiStack(app, 'Ci', {
  env,
  deployEnv: 'sandbox',
  webBucket: web.bucket,
  webDistribution: web.distribution,
});
const t = (stack: cdk.Stack) => Template.fromStack(stack);

describe('DataStack', () => {
  it('has a table with PITR, the GSI and on-demand billing', () => {
    t(data).hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      TableName: 'purr-sandbox',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'GSI1' })],
      Replicas: [
        Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } }),
      ],
    });
  });

  it('has no events queue (indexing is nightly and on demand)', () => {
    t(data).resourceCountIs('AWS::SQS::Queue', 0);
  });
});

describe('AuthStack', () => {
  it('creates a code-grant client with its own managed-login branding', () => {
    t(auth).hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'purr-sandbox',
      AllowedOAuthFlows: ['code'],
      CallbackURLs: Match.arrayWith(['https://purr.sandbox.nakomis.com/loggedin']),
    });
    t(auth).resourceCountIs('AWS::Cognito::ManagedLoginBranding', 1);
  });
});

describe('ApiStack', () => {
  it('runs the API and the indexer with the right environment and one indexer at a time', () => {
    const tpl = t(api);
    tpl.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'purr-api-sandbox',
      Environment: {
        Variables: Match.objectLike({ ALLOWED_EMAILS: 'sandboxuser@nakomis.com', VERSION: '1.2.3' }),
      },
    });
    tpl.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'purr-indexer-sandbox',
      ReservedConcurrentExecutions: 1,
    });
  });

  it('rebuilds the index on demand and nightly, not from a queue', () => {
    const t = Template.fromStack(api);
    t.resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'purr-api-sandbox',
      Environment: { Variables: Match.objectLike({ INDEXER_FUNCTION_NAME: Match.anyValue() }) },
    });
    t.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(5 0 * * ? *)',
      ScheduleExpressionTimezone: 'Europe/London',
    });
    const policies = JSON.stringify(t.findResources('AWS::IAM::Policy'));
    expect(policies).toContain('lambda:InvokeFunction');
  });

  it('may invoke only the Titan embedding model', () => {
    t(api).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'bedrock:InvokeModel',
            Resource: 'arn:aws:bedrock:eu-west-2::foundation-model/amazon.titan-embed-text-v2:0',
          }),
        ]),
      },
    });
  });
});

describe('WebStack', () => {
  it('never rewrites errors distribution-wide (the API keeps its 403s and 404s)', () => {
    const dists = t(web).findResources('AWS::CloudFront::Distribution');
    for (const d of Object.values(dists)) {
      expect(d.Properties.DistributionConfig.CustomErrorResponses).toBeUndefined();
    }
  });

  it('routes /api/* to the API uncached, and rewrites SPA paths on the default behaviour only', () => {
    const dist = Object.values(t(web).findResources('AWS::CloudFront::Distribution'))[0]?.Properties
      .DistributionConfig;
    expect(dist.Aliases).toEqual(['purr.sandbox.nakomis.com']);
    expect(dist.CacheBehaviors).toHaveLength(1);
    const apiBehaviour = dist.CacheBehaviors[0];
    expect(apiBehaviour.PathPattern).toBe('/api/*');
    expect(apiBehaviour.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad'); // CachingDisabled
    expect(apiBehaviour.AllowedMethods).toEqual(expect.arrayContaining(['POST', 'PATCH', 'PUT', 'DELETE']));
    expect(apiBehaviour.FunctionAssociations).toBeUndefined();
    expect(dist.DefaultCacheBehavior.FunctionAssociations).toEqual([
      expect.objectContaining({ EventType: 'viewer-request' }),
    ]);
  });

  it('publishes the bucket and distribution for the web deploy', () => {
    t(web).hasResourceProperties('AWS::SSM::Parameter', { Name: '/purr/sandbox/web/bucket-name' });
    t(web).hasResourceProperties('AWS::SSM::Parameter', { Name: '/purr/sandbox/web/distribution-id' });
  });
});

describe('GithubCiStack', () => {
  it('trusts both OIDC subject forms for the purr repo', () => {
    t(ci).hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'nakomis-purr-github-ci-sandbox',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
              StringLike: {
                'token.actions.githubusercontent.com:sub': [
                  'repo:nakomis@1488244/purr@1467651029:*',
                  'repo:nakomis/purr:*',
                ],
              },
            },
          }),
        ],
      },
    });
  });
});
