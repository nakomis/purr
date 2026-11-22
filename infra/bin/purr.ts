#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { ACCOUNTS, type DeployEnv, REGION } from '../lib/config';
import { DataStack } from '../lib/data-stack';
import { GithubCiStack } from '../lib/github-ci-stack';
import { WebCertStack } from '../lib/web-cert-stack';
import { WebStack } from '../lib/web-stack';

const npmEnvironment = process.env.NPM_ENVIRONMENT;
if (!npmEnvironment) {
  throw new Error('NPM_ENVIRONMENT is not set. Use `pnpm run deploy-sandbox` or `pnpm run deploy-prod`.');
}
if (npmEnvironment !== 'sandbox' && npmEnvironment !== 'prod') {
  throw new Error(`Unknown NPM_ENVIRONMENT "${npmEnvironment}". Must be "sandbox" or "prod".`);
}
const deployEnv = npmEnvironment as DeployEnv;
const account = ACCOUNTS[deployEnv];
const env = { account, region: REGION };

const versionFile = path.join(__dirname, '..', 'version.json');
const version: string = fs.existsSync(versionFile)
  ? JSON.parse(fs.readFileSync(versionFile, 'utf-8')).version
  : '0.0.0-local';

const app = new cdk.App();

const data = new DataStack(app, 'PurrDataStack', {
  env,
  deployEnv,
  description: `Purr data: DynamoDB table, search bucket and events queue (${deployEnv})`,
});

const auth = new AuthStack(app, 'PurrAuthStack', {
  env,
  deployEnv,
  description: `Purr's Cognito app client on the shared pool (${deployEnv})`,
});

const api = new ApiStack(app, 'PurrApiStack', {
  env,
  deployEnv,
  version,
  table: data.table,
  dataBucket: data.bucket,
  eventsQueue: data.eventsQueue,
  userPoolId: auth.userPoolId,
  userPoolClientId: auth.clientId,
  description: `Purr HTTP API, search indexer and their Lambdas (${deployEnv})`,
});

const cert = new WebCertStack(app, 'PurrWebCertStack', {
  env: { account, region: 'us-east-1' },
  deployEnv,
  crossRegionReferences: true,
  description: `ACM certificate for Purr's domain (us-east-1, for CloudFront) (${deployEnv})`,
});

const web = new WebStack(app, 'PurrWebStack', {
  env,
  deployEnv,
  certificate: cert.certificate,
  httpApi: api.httpApi,
  crossRegionReferences: true,
  description: `Purr web: S3, CloudFront (SPA and /api), DNS (${deployEnv})`,
});

new GithubCiStack(app, 'PurrGithubCiStack', {
  env,
  deployEnv,
  webBucket: web.bucket,
  webDistribution: web.distribution,
  description: `GitHub Actions OIDC role for Purr CI (${deployEnv})`,
});

cdk.Tags.of(app).add('MH-Project', 'purr');
cdk.Tags.of(app).add('MH-Version', version);
