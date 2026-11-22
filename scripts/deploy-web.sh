#!/usr/bin/env bash
# Build the web UI for an environment and publish it: config.json from SSM, the
# release version, a Vite build, an S3 sync and a CloudFront invalidation.
#
# Usage: scripts/deploy-web.sh sandbox|prod
#   Locally it uses nakom.is-sandbox / nakom.is-admin; in CI, the credentials that
#   configure-aws-credentials put in the environment.
set -euo pipefail

ENV="${1:?usage: deploy-web.sh sandbox|prod}"
case "$ENV" in
  sandbox) PROFILE=nakom.is-sandbox ;;
  prod) PROFILE=nakom.is-admin ;;
  *) echo "unknown environment: $ENV" >&2; exit 2 ;;
esac
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then export AWS_PROFILE="${AWS_PROFILE:-$PROFILE}"; fi
export AWS_REGION="${AWS_REGION:-eu-west-2}" AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-eu-west-2}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
ssm() { aws ssm get-parameter --name "/purr/${ENV}/$1" --query Parameter.Value --output text; }

bash "$WEB/scripts/set-config.sh" "$ENV"
if [[ -f "$ROOT/infra/version.json" ]]; then cp "$ROOT/infra/version.json" "$WEB/public/version.json"; fi

(cd "$WEB" && pnpm build)

BUCKET="$(ssm web/bucket-name)"
DIST="$(ssm web/distribution-id)"

# Hashed assets can be cached for ever; everything else must revalidate. icons/ is
# owned by the importer (one per project), so the sync never deletes it.
aws s3 sync "$WEB/dist/" "s3://$BUCKET/" --delete --exclude "icons/*" \
  --exclude "index.html" --exclude "config.json" --exclude "version.json" \
  --cache-control "public, max-age=31536000, immutable"
for f in index.html config.json version.json; do
  if [[ -f "$WEB/dist/$f" ]]; then
    aws s3 cp "$WEB/dist/$f" "s3://$BUCKET/$f" --cache-control "no-cache"
  fi
done
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/index.html" "/config.json" "/version.json" >/dev/null
echo "Published the web UI to https://$(ssm web/domain)"
