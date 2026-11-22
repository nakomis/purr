import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { appDomain, type DeployEnv, ssmName } from './config';
import { purrManagedLoginBranding } from './managed-login-branding';

export interface AuthStackProps extends cdk.StackProps {
  deployEnv: DeployEnv;
}

/**
 * Purr's app client on the shared Nakomis user pool, with its own managed-login
 * branding (a client with none gets "Login pages unavailable"), and the SSM
 * parameters the web deploy reads to write config.json.
 */
export class AuthStack extends cdk.Stack {
  readonly userPoolId: string;
  readonly clientId: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { deployEnv } = props;
    const domain = appDomain(deployEnv);

    this.userPoolId = ssm.StringParameter.valueForStringParameter(
      this,
      `/nakomis-infra/${deployEnv}/cognito/user-pool-id`,
    );
    const loginDomain = ssm.StringParameter.valueForStringParameter(
      this,
      `/nakomis-infra/${deployEnv}/cognito/login-domain`,
    );
    const userPool = cognito.UserPool.fromUserPoolId(this, 'SharedPool', this.userPoolId);

    const client = new cognito.UserPoolClient(this, 'WebClient', {
      userPoolClientName: `purr-${deployEnv}`,
      userPool,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          `https://${domain}/loggedin`,
          'http://localhost:5173/loggedin',
          'http://localhost:3000/loggedin',
        ],
        logoutUrls: [
          `https://${domain}/logout`,
          'http://localhost:5173/logout',
          'http://localhost:3000/logout',
        ],
      },
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });
    this.clientId = client.userPoolClientId;

    const branding = purrManagedLoginBranding(this, 'LoginBranding', {
      userPoolId: this.userPoolId,
      clientId: client.userPoolClientId,
      logo: fs.readFileSync(path.join(__dirname, '../assets/purr-logo-150.png')),
    });
    branding.node.addDependency(client);

    const params: [string, string, string][] = [
      ['ClientIdParam', 'cognito/client-id', client.userPoolClientId],
      ['UserPoolIdParam', 'cognito/user-pool-id', this.userPoolId],
      ['LoginDomainParam', 'cognito/login-domain', loginDomain],
      ['WebDomainParam', 'web/domain', domain],
    ];
    for (const [cid, name, value] of params) {
      new ssm.StringParameter(this, cid, { parameterName: ssmName(deployEnv, name), stringValue: value });
    }
  }
}
