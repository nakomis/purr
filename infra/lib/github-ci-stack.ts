import * as cdk from 'aws-cdk-lib';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { type DeployEnv, GITHUB } from './config';

/** Account hosting the shared deployment tracker (the nakomis prod account). */
const DEPLOYMENT_TRACKER_ACCOUNT = '637423226886';

export interface GithubCiStackProps extends cdk.StackProps {
  deployEnv: DeployEnv;
  webBucket: s3.IBucket;
  webDistribution: cloudfront.IDistribution;
}

/** The role GitHub Actions assumes (by OIDC) to deploy Purr: CDK, the SPA, and the deployment tracker. */
export class GithubCiStack extends cdk.Stack {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: GithubCiStackProps) {
    super(scope, id, props);
    const { deployEnv } = props;
    // Prod trusts only jobs in the `production` environment, which needs Martin's approval.
    const context = deployEnv === 'prod' ? 'environment:production' : '*';
    const oidc = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GithubOidc',
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    this.role = new iam.Role(this, 'CiRole', {
      roleName: `nakomis-purr-github-ci-${deployEnv}`,
      description: `Assumed by Purr's GitHub Actions CI (${deployEnv})`,
      assumedBy: new iam.WebIdentityPrincipal(oidc.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        // GitHub's OIDC subject carries immutable ids (repo:OWNER@ID/REPO@ID:CONTEXT)
        // for recently created repos and the name-only form for older ones. A list is
        // an OR; trusting both means the role works whichever GitHub presents.
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${GITHUB.owner}@${GITHUB.ownerId}/${GITHUB.repo}@${GITHUB.repoId}:${context}`,
            `repo:${GITHUB.owner}/${GITHUB.repo}:${context}`,
          ],
        },
      }),
      inlinePolicies: {
        CdkDeploy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['sts:AssumeRole'],
              resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
            }),
          ],
        }),
        // The tracker is a REST API in the prod account: the sandbox role calls it
        // cross-account, so it needs this identity grant as well as the tracker's allow-list.
        DeploymentTracker: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['execute-api:Invoke'],
              resources: [`arn:aws:execute-api:eu-west-2:${DEPLOYMENT_TRACKER_ACCOUNT}:*/*/*/deployments/*`],
            }),
          ],
        }),
        WebDeploy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['s3:PutObject', 's3:DeleteObject'],
              resources: [`${props.webBucket.bucketArn}/*`],
            }),
            new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [props.webBucket.bucketArn] }),
            new iam.PolicyStatement({
              actions: ['cloudfront:CreateInvalidation'],
              resources: [
                `arn:aws:cloudfront::${this.account}:distribution/${props.webDistribution.distributionId}`,
              ],
            }),
            new iam.PolicyStatement({
              actions: ['ssm:GetParameter', 'ssm:GetParameters'],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/purr/${deployEnv}/*`],
            }),
          ],
        }),
      },
    });

    new cdk.CfnOutput(this, 'CiRoleArn', { value: this.role.roleArn });
  }
}
