import * as cdk from 'aws-cdk-lib';
import type * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { appDomain, type DeployEnv, HOSTED_ZONES, ssmName } from './config';

export interface WebStackProps extends cdk.StackProps {
  deployEnv: DeployEnv;
  certificate: acm.ICertificate;
  httpApi: apigwv2.IHttpApi;
}

/**
 * Rewrites extensionless paths to /index.html so client-side routes load the SPA.
 * On the default (S3) behaviour only: distribution-wide errorResponses would also
 * turn the API's deliberate 403s and 404s into 200 + index.html.
 */
const SPA_REWRITE = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`;

/** The SPA bucket and one CloudFront distribution serving the SPA and, under /api, the HTTP API. */
export class WebStack extends cdk.Stack {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const { deployEnv } = props;
    const isProd = deployEnv === 'prod';
    const domain = appDomain(deployEnv);

    this.bucket = new s3.Bucket(this, 'SpaBucket', {
      bucketName: `purr-web-${this.account}-${deployEnv}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      functionName: `purr-spa-rewrite-${deployEnv}`,
      code: cloudfront.FunctionCode.fromInline(SPA_REWRITE),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const apiOrigin = new origins.HttpOrigin(cdk.Fn.select(2, cdk.Fn.split('/', props.httpApi.apiEndpoint)), {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `purr-security-${deployEnv}`,
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: false,
          override: true,
        },
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Purr (${deployEnv})`,
      domainNames: [domain],
      certificate: props.certificate,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [
          { function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
        },
      },
    });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', HOSTED_ZONES[deployEnv]);
    const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution));
    new route53.ARecord(this, 'AliasA', { zone, recordName: domain, target });
    new route53.AaaaRecord(this, 'AliasAaaa', { zone, recordName: domain, target });

    new ssm.StringParameter(this, 'BucketNameParam', {
      parameterName: ssmName(deployEnv, 'web/bucket-name'),
      stringValue: this.bucket.bucketName,
    });
    new ssm.StringParameter(this, 'DistributionIdParam', {
      parameterName: ssmName(deployEnv, 'web/distribution-id'),
      stringValue: this.distribution.distributionId,
    });

    new cdk.CfnOutput(this, 'Url', { value: `https://${domain}` });
    new cdk.CfnOutput(this, 'BucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
  }
}
