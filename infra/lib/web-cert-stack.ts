import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';
import { appDomain, type DeployEnv, HOSTED_ZONES } from './config';

export interface WebCertStackProps extends cdk.StackProps {
  deployEnv: DeployEnv;
}

/** The certificate for purr.<zone>, in us-east-1 as CloudFront requires. */
export class WebCertStack extends cdk.Stack {
  readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: WebCertStackProps) {
    super(scope, id, props);
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', HOSTED_ZONES[props.deployEnv]);
    this.certificate = new acm.Certificate(this, 'Cert', {
      domainName: appDomain(props.deployEnv),
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}
